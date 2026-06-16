/**
 * The reading agent's single entrypoint: given a conversation, a paper/page in
 * context, and an OpenRouter key, run the tool-using agentic loop and stream
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
import type { ParsedPaper } from "@/lib/review-types";
import { getAllTools } from "@/tools/registry";
import type { ToolContext } from "@/tools/types";
import { runOpenRouterAgentLoop } from "@/app/api/chat/openrouter-handler";
import { getReadingSystemPrompt, visualFormatReminder } from "@/recipes/reading-agent";

// Re-export so the chat route resolves the prompt (for context budgeting)
// through the same module it runs the agent from.
export { getReadingSystemPrompt };

/** Paper-internal tools, registered only when the paper is parsed to structured
 *  form — otherwise the model sees them and calls them only to get a "not
 *  parsed yet" error back. */
const PAPER_PARSED_TOOLS = new Set([
  "read_section",
  "search_paper",
  "lookup_citation",
]);

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

export interface ReadingAgentParams {
  /** The conversation to send the model (already budgeted to the context
   *  window by the caller, if it cares). */
  conversation: TranscriptMessage[];
  /** Resolved OpenRouter key. */
  apiKey: string;
  /** Full paper/page text (short-source mode). */
  paperContext?: string;
  /** Structured paper (long-source mode); enables the paper-internal tools. */
  parsedPaper?: ParsedPaper;
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
  /** Receives every stream event the loop produces. */
  emit: (event: StreamEvent) => void;
}

/**
 * Select the tools to register for a turn, exactly as the chat route does:
 * drop `web_search` when the user dismissed it, drop the paper-internal tools
 * until the paper is parsed, and register `submit_picks` only in discover mode.
 */
export function selectReadingTools(params: {
  parsedPaper?: ParsedPaper;
  skipWebSearch?: boolean;
  mode?: "discover";
}) {
  return getAllTools().filter((t) => {
    if (params.skipWebSearch && t.name === "web_search") return false;
    if (!params.parsedPaper && PAPER_PARSED_TOOLS.has(t.name)) return false;
    if (params.mode !== "discover" && DISCOVER_ONLY_TOOLS.has(t.name)) return false;
    return true;
  });
}

export async function runReadingAgent(params: ReadingAgentParams): Promise<void> {
  const {
    conversation,
    apiKey,
    paperContext,
    parsedPaper,
    paperTitle,
    arxivId,
    reviewId,
    sourceUrl,
    exaApiKey,
    skipWebSearch,
    mode,
    emit,
  } = params;

  const tools = selectReadingTools({ parsedPaper, skipWebSearch, mode });
  const toolContext: ToolContext = {
    paperContext,
    parsedPaper,
    paperTitle,
    arxivId,
    reviewId,
    exaApiKey: exaApiKey || undefined,
  };
  const systemPrompt = getReadingSystemPrompt(sourceUrl, mode);

  await runOpenRouterAgentLoop(
    conversation,
    apiKey,
    systemPrompt,
    paperContext,
    parsedPaper,
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
  );
}
