/**
 * The reading agent's single entrypoint: given a conversation, a paper/page in
 * context, and a Fireworks key, run the tool-using agentic loop and stream
 * its events to `emit`. This is the highest-level call that IS the agent —
 * everything below it (tool selection, the ReAct loop, the SSE parsing) is
 * shared, and everything above it in the chat route (auth, rate-limit
 * metering, transcript persistence, context budgeting) is HTTP plumbing that
 * is NOT part of the agent.
 *
 * The `/api/chat` route wraps it with the plumbing above.
 */

import type { StreamEvent } from "@/lib/stream-types";
import type { TranscriptMessage } from "@/lib/transcript";
import type { ChunkHit } from "@/lib/documents";
import { getAllTools } from "@/tools/registry";
import type { ArtifactStore, ToolContext } from "@/tools/types";
import { runFireworksAgentLoop } from "@/app/api/chat/fireworks-handler";
import { getReadingSystemPrompt, visualFormatReminder } from "@/recipes/reading-agent";
import { runDiscoverFunnel } from "./discover-funnel";

// Re-export so the chat route resolves the prompt (for context budgeting)
// through the same module it runs the agent from.
export { getReadingSystemPrompt };

/** Registered only when the turn has a document to search (its chunk index). */
const CHUNK_INDEX_TOOLS = new Set(["search_paper"]);

/** Registered only when the turn has a review to save artifacts into. */
const ARTIFACT_TOOLS = new Set(["create_artifact", "update_artifact", "read_artifact"]);

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
  /**
   * Passages retrieved for this turn. `null` means retrieval ran and nothing
   * cleared the floor; `undefined` means there's no document in this turn.
   */
  retrievedContext?: string | null;
  /** Document title, when known. */
  documentTitle?: string;
  /** Table of contents, one heading per line with page. */
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
  /** The review's artifacts, bound to the user; enables the artifact tools. */
  artifacts?: ArtifactStore;
  /** What the model should know about the review's artifacts this turn
   *  (the open one's source, the others by ref), pinned after the history. */
  artifactContext?: string;
  /** Receives every stream event the loop produces. */
  emit: (event: StreamEvent) => void;
}

/**
 * Select the tools to register for a reading turn, exactly as the chat route
 * does: drop `web_search` when the user dismissed it, register
 * `search_paper` only when the document has a chunk index, and the artifact
 * tools only when there's a review to save into.
 */
export function selectReadingTools(params: {
  hasChunkIndex?: boolean;
  skipWebSearch?: boolean;
  hasArtifacts?: boolean;
}) {
  return getAllTools().filter((t) => {
    if (params.skipWebSearch && t.name === "web_search") return false;
    if (!params.hasChunkIndex && CHUNK_INDEX_TOOLS.has(t.name)) return false;
    if (!params.hasArtifacts && ARTIFACT_TOOLS.has(t.name)) return false;
    if (DISCOVER_ONLY_TOOLS.has(t.name)) return false;
    return true;
  });
}

export async function runReadingAgent(params: ReadingAgentParams): Promise<void> {
  const {
    conversation,
    apiKey,
    retrievedContext,
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
    artifacts,
    artifactContext,
    emit,
  } = params;

  // Discover: search wide, screen with the Jev judge, LLM picks from the
  // shortlist. See src/server/discover-funnel.ts.
  if (mode === "discover") {
    const lastUser = [...conversation].reverse().find((m) => m.role === "user");
    await runDiscoverFunnel({
      conversation,
      apiKey,
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
    hasArtifacts: !!artifacts,
  });
  const toolContext: ToolContext = {
    artifacts,
    searchChunks,
    paperTitle,
    arxivId,
    reviewId,
    exaApiKey: exaApiKey || undefined,
  };
  const systemPrompt = getReadingSystemPrompt({ sourceUrl, arxivId });

  await runFireworksAgentLoop(
    conversation,
    apiKey,
    systemPrompt,
    retrievedContext !== undefined
      ? { retrieved: retrievedContext, title: documentTitle, tableOfContents }
      : undefined,
    tools,
    toolContext,
    emit,
    // Reading surfaces draw visuals; pin the format rules with recency so
    // old in-conversation examples can't override them.
    {
      trailingSystemReminder: artifactContext
        ? `${visualFormatReminder()}\n\n${artifactContext}`
        : visualFormatReminder(),
    },
  );
}
