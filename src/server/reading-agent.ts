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

// Re-export so the chat route resolves the prompt (for context budgeting)
// through the same module it runs the agent from.
export { getReadingSystemPrompt };

/** Registered only when the document has a chunk index (long documents); a
 *  short document is fully in context and the tool would have nothing to do. */
const CHUNK_INDEX_TOOLS = new Set(["search_paper"]);

/** Discover's structured-output tool; the reading surfaces never register it
 *  (the discover funnel picks its own tools). */
const DISCOVER_ONLY_TOOLS = new Set(["submit_picks"]);

export interface DiscoverOptions {
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
  /** `"discover"` runs the discover funnel (wide search, Jev screening, LLM
   *  picks the reading list). Default is the paper/web reading agent. */
  mode?: "discover";
  /** Discover only: inputs for the screening funnel. */
  discover?: DiscoverOptions;
  /** Receives every stream event the loop produces. */
  emit: (event: StreamEvent) => void;
}

/**
 * Select the tools to register for a reading turn, exactly as the chat route
 * does: drop `web_search` when the user dismissed it, and register
 * `search_paper` only when the document has a chunk index.
 */
export function selectReadingTools(params: {
  hasChunkIndex?: boolean;
  skipWebSearch?: boolean;
}) {
  return getAllTools().filter((t) => {
    if (params.skipWebSearch && t.name === "web_search") return false;
    if (!params.hasChunkIndex && CHUNK_INDEX_TOOLS.has(t.name)) return false;
    if (DISCOVER_ONLY_TOOLS.has(t.name)) return false;
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

  // Discover: search wide, screen with the Jev judge, LLM picks from the
  // shortlist. See src/server/discover-funnel.ts.
  if (mode === "discover") {
    const lastUser = [...conversation].reverse().find((m) => m.role === "user");
    await runDiscoverFunnel({
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
    return;
  }

  const tools = selectReadingTools({
    hasChunkIndex: !!searchChunks,
    skipWebSearch,
  });
  const toolContext: ToolContext = {
    paperContext,
    searchChunks,
    paperTitle,
    arxivId,
    reviewId,
    exaApiKey: exaApiKey || undefined,
  };
  const systemPrompt = getReadingSystemPrompt(sourceUrl);

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
    // Reading surfaces draw visuals; pin the format rules with recency so
    // old in-conversation examples can't override them.
    { trailingSystemReminder: visualFormatReminder() },
    model,
  );
}
