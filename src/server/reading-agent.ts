/**
 * The reading agent's single entrypoint: given a conversation, a paper/page in
 * context, and a Fireworks key, run the tool-using agentic loop and stream
 * its events to `emit`. This is the highest-level call that IS the agent —
 * everything below it (tool selection, the ReAct loop, the SSE parsing) is
 * shared, and everything above it in the chat route (auth, rate-limit
 * metering, transcript persistence, context budgeting) is HTTP plumbing that
 * is NOT part of the agent.
 *
 * Both callers go through here so they can't drift: the `/api/chat` route wraps
 * it with the plumbing above, and offline eval harnesses import and call it
 * directly with just a key (no dev server, no auth, no DB). It is deliberately
 * free of any `server-only` / DB / Next-runtime imports so it runs unchanged in
 * a plain Node/tsx process.
 */

import type { StreamEvent } from "@/lib/stream-types";
import type { TranscriptMessage } from "@/lib/transcript";
import type { ChunkHit } from "@/lib/documents";
import { getAllTools } from "@/tools/registry";
import type { ToolContext } from "@/tools/types";
import { runFireworksAgentLoop } from "@/app/api/chat/fireworks-handler";
import { getReadingSystemPrompt, visualFormatReminder } from "@/recipes/reading-agent";
import { runDiscoverFunnel } from "./discover-funnel";
import { judgeAvailable } from "./judge";

// Re-export so the chat route resolves the prompt (for context budgeting)
// through the same module it runs the agent from.
export { getReadingSystemPrompt };

/** Registered only when the document has a chunk index (long documents); a
 *  short document is fully in context and the tool would have nothing to do. */
const CHUNK_INDEX_TOOLS = new Set(["search_paper"]);

/** Structured-output tools that only the surface using them should register. */
const DISCOVER_ONLY_TOOLS = new Set(["submit_picks"]);

/** Discover's completion-gate nudge: forces `submit_picks` when candidates were
 *  gathered but never submitted, so the user isn't left with nothing. */
const DISCOVER_SUBMIT_NUDGE =
  "You gathered search results and read candidates but never called submit_picks, " +
  "so the user would see nothing. Call submit_picks NOW with the 4–6 strongest " +
  "candidates (fewer if the pool is small) — each with a one-sentence rationale and " +
  "a canonical URL. Then write the explainer paragraph. Do not ask a question or " +
  "stop; submit the picks.";

export interface DiscoverOptions {
  /** "funnel": search wide, screen with the Jev judge, LLM picks from the
   *  shortlist (the default whenever a judge is configured). "agent": the
   *  single discovery agent that searches and picks on its own. */
  pipeline?: "funnel" | "agent";
  /** The question screening judges against, without prompt scaffolding.
   *  Defaults to the last user message. */
  question?: string;
  projectName?: string | null;
  /** Sources the project already has; never screened or picked. */
  exclude?: { arxivIds?: string[]; urls?: string[] };
}

export interface ReadingAgentParams {
  /** The conversation to send the model (already budgeted to the context
   *  window by the caller, if it cares). */
  conversation: TranscriptMessage[];
  /** Resolved Fireworks key. */
  apiKey: string;
  /** Optional model override for offline evals; app traffic uses the fixed model. */
  model?: string;
  /** Full paper/page text (short-source mode). */
  paperContext?: string;
  /**
   * Passages retrieved for this turn (long-source mode). `null` means
   * retrieval ran and nothing cleared the floor; `undefined` means the turn
   * is not in retrieval mode.
   */
  retrievedContext?: string | null;
  /** Appended to the paper block, e.g. "only the first N pages are available
   *  while indexing finishes". */
  paperNote?: string;
  /** Document title, when known. */
  documentTitle?: string;
  /** Table of contents (retrieval mode), one heading per line with page. */
  tableOfContents?: string;
  /** Vector search over the document's chunks; enables `search_paper`. */
  searchChunks?: (query: string, k: number) => Promise<ChunkHit[]>;
  paperTitle?: string;
  arxivId?: string;
  reviewId?: string;
  /** Set when reviewing an arbitrary web page rather than a paper/PDF; selects
   *  the page system prompt and citation style. */
  sourceUrl?: string;
  /** User-provided Exa key for `web_search`; absent → the tool returns its
   *  configure-key sentinel. */
  exaApiKey?: string;
  /** The user dismissed the Exa-key card: drop `web_search` for the turn. */
  skipWebSearch?: boolean;
  /** `"discover"` swaps in the discovery prompt + `submit_picks` and forces it
   *  as the final tool. Default is the paper/web reading agent. */
  mode?: "discover";
  /** Discover only: inputs for the screening funnel. */
  discover?: DiscoverOptions;
  /** Receives every stream event the loop produces. */
  emit: (event: StreamEvent) => void;
}

/**
 * Select the tools to register for a turn, exactly as the chat route does:
 * drop `web_search` when the user dismissed it, register `search_paper` only
 * when the document has a chunk index, and `submit_picks` only in discover
 * mode.
 */
export function selectReadingTools(params: {
  hasChunkIndex?: boolean;
  skipWebSearch?: boolean;
  mode?: "discover";
}) {
  return getAllTools().filter((t) => {
    if (params.skipWebSearch && t.name === "web_search") return false;
    if (!params.hasChunkIndex && CHUNK_INDEX_TOOLS.has(t.name)) return false;
    if (params.mode !== "discover" && DISCOVER_ONLY_TOOLS.has(t.name)) return false;
    return true;
  });
}

export async function runReadingAgent(params: ReadingAgentParams): Promise<void> {
  const {
    conversation,
    apiKey,
    model,
    paperContext,
    retrievedContext,
    paperNote,
    documentTitle,
    tableOfContents,
    searchChunks,
    paperTitle,
    arxivId,
    reviewId,
    sourceUrl,
    exaApiKey,
    skipWebSearch,
    mode,
    discover,
    emit,
  } = params;

  if (
    mode === "discover" &&
    (discover?.pipeline ?? (judgeAvailable() ? "funnel" : "agent")) === "funnel"
  ) {
    const lastUser = [...conversation].reverse().find((m) => m.role === "user");
    const outcome = await runDiscoverFunnel({
      conversation,
      apiKey,
      model,
      question: discover?.question?.trim() || lastUser?.content || "",
      projectName: discover?.projectName ?? null,
      exclude: discover?.exclude,
      exaApiKey,
      skipWebSearch,
      emit,
    });
    if (outcome === "done") return;
    // Nothing to screen (every search came back empty): let the agent try
    // its own reformulations.
  }

  const tools = selectReadingTools({
    hasChunkIndex: !!searchChunks,
    skipWebSearch,
    mode,
  });
  const toolContext: ToolContext = {
    paperContext,
    searchChunks,
    paperTitle,
    arxivId,
    reviewId,
    exaApiKey: exaApiKey || undefined,
  };
  const systemPrompt = getReadingSystemPrompt(sourceUrl, mode);

  await runFireworksAgentLoop(
    conversation,
    apiKey,
    systemPrompt,
    paperContext || retrievedContext !== undefined
      ? {
          text: paperContext,
          retrieved: retrievedContext,
          title: documentTitle,
          tableOfContents,
          note: paperNote,
        }
      : undefined,
    tools,
    toolContext,
    emit,
    mode === "discover"
      ? {
          requiredFinalTool: {
            name: "submit_picks",
            nudge: DISCOVER_SUBMIT_NUDGE,
            maxNudges: 2,
          },
        }
      : // Reading surfaces draw visuals; pin the format rules with recency so
        // old in-conversation examples can't override them.
        { trailingSystemReminder: visualFormatReminder() },
    model,
  );
}
