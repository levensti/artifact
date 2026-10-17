/**
 * Agentic chat endpoint.
 *
 * Implements a server-side ReAct loop: the LLM can call tools (arXiv search,
 * web search, etc.) as many times as needed, and the loop feeds results
 * back until the LLM produces a final text response.
 *
 * Streams NDJSON events to the client:
 *   {"type":"text_delta","text":"..."}
 *   {"type":"tool_call","id":"...","name":"...","input":{...}}
 *   {"type":"tool_result","id":"...","name":"...","output":"..."}
 *   {"type":"error","message":"..."}
 *   {"type":"done"}
 */

import { NextRequest } from "next/server";
import {
  computeShouldCompact,
  getFireworksContextWindow,
  TOKEN_RESERVE,
} from "@/lib/fireworks";
import type { StreamEvent } from "@/lib/stream-types";
import { jsonError } from "@/lib/api-utils";
import {
  estimateTokens,
  fitTranscriptToBudget,
  type TranscriptMessage,
} from "@/lib/transcript";
import {
  processStreamEvent,
  stepsToBlocks,
  stepsToContent,
  type AgentStep,
} from "@/lib/agent-steps";
import { retireLegacyVisualFences } from "@/lib/diagram/fence";
import { requireUserId, HttpError, errorResponse } from "@/server/api";
import {
  resolveMeteredKey,
  charge,
  meteredTokens,
  EMBEDDING_TOKEN_WEIGHT,
} from "@/server/rate-limit";
import * as store from "@/server/store";
import * as docs from "@/server/documents";
import { retrieveContext } from "@/server/retrieval";
import { embedTexts } from "@/server/embeddings";
import { documentMode, RETRIEVAL_THRESHOLD_CHARS } from "@/lib/documents";
import { buildPaperBlock, type PaperBlockInput } from "./paper-block";
import {
  getReadingSystemPrompt,
  runReadingAgent,
  type ReadingAgentParams,
  type DiscoverOptions,
} from "@/server/reading-agent";
import type { ChatMessage, ContextMetadata } from "@/lib/review-types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatRequest {
  /**
   * Stateless history (legacy path). Used by the discover surface and the
   * selection-thread chat: the client owns the transcript and sends it inline.
   * For the main review chat the server now owns state — see `userMessage`.
   * Assistant messages may carry structured `blocks` (text interleaved with
   * tool calls + outputs) so the agent can replay its own prior tool work.
   */
  messages?: TranscriptMessage[];
  /**
   * Server-owned path (main review chat). The new user message text. When
   * present (with `reviewId`, non-discover), the server loads the conversation
   * from the DB, appends + persists this turn, budgets it to the model's
   * context window, and persists the assistant reply on completion — the
   * client no longer sends or stores the history.
   */
  userMessage?: string;
  /** Client-generated id for the new user message, so optimistic UI and the
   *  persisted row share an id. Re-sending the same id is idempotent (a retry
   *  re-runs the stored turn instead of duplicating it). */
  userMessageId?: string;
  /** Client-generated id for the assistant reply, for the same id alignment. */
  assistantMessageId?: string;
  /** Re-run the last stored user message without appending a new one. Used by
   *  the Exa-key resume flow after the turn paused waiting on a key decision. */
  resume?: boolean;
  /** Optional per-user Fireworks key override. Server falls back to env. */
  apiKey?: string;
  /**
   * Content hash of the document being read (see `POST /api/documents`).
   * The server resolves everything about the paper from this: short
   * documents are injected whole from the stored text; long ones get
   * passages retrieved for the current turn from the chunk index. The
   * browser never sends paper text with a chat turn.
   */
  documentHash?: string;
  paperTitle?: string;
  arxivId?: string;
  reviewId?: string;
  /** Set when the review is for an arbitrary web page rather than a paper/PDF. */
  sourceUrl?: string;
  /**
   * Selects which system prompt and tool subset to use. Default is the
   * paper/web reading agent. `"discover"` swaps in a discovery-focused
   * prompt and (since there's no paper context) only registers
   * `arxiv_search` and `web_search` — `search_paper` is already gated on
   * the document having a chunk index, so it self-disables in this mode.
   */
  mode?: "discover";
  /**
   * Discover only: inputs for the screening funnel (the short question to
   * judge against, the project, and sources the project already has).
   */
  discover?: {
    question?: string;
    projectName?: string | null;
    exclude?: { arxivIds?: string[]; urls?: string[] };
  };
  /**
   * User-provided Exa API key. When absent the `web_search` tool returns
   * a sentinel that the chat UI surfaces as a configure card.
   */
  exaApiKey?: string;
  /**
   * Set when the user has explicitly dismissed the "configure Exa key"
   * card and wants the agent to proceed without web search. The chat
   * handler unregisters `web_search` for the turn so the agent doesn't
   * attempt it again.
   */
  skipWebSearch?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Paper resolution                                                   */
/* ------------------------------------------------------------------ */

interface ResolvedPaper {
  /** What the agent receives (paper text / retrieved passages / tools). */
  agent?: Pick<
    ReadingAgentParams,
    | "paperContext"
    | "retrievedContext"
    | "paperNote"
    | "documentTitle"
    | "tableOfContents"
    | "searchChunks"
  >;
  /** The same, shaped for `buildPaperBlock` (context budgeting). */
  block?: PaperBlockInput;
  /** Cost-weighted tokens spent before the stream (rewrite + embedding). */
  meteredTokens?: number;
}

/**
 * Turn a document hash into what this turn's prompt should carry.
 *
 *   - no hash / unknown document / no text yet → nothing (chat proceeds
 *     without a paper; the client uploads text on open),
 *   - short document → the full stored text,
 *   - long + indexed → passages retrieved for the latest user message,
 *     plus a `search_paper` closure for follow-up retrieval,
 *   - long + not yet indexed → the leading slice with a note, so chat
 *     degrades instead of blocking on the index.
 *
 * Also links the review to the document when it isn't yet (the hash only
 * exists client-side, so the edge is created lazily on first contact).
 */
async function resolvePaper(params: {
  userId: string;
  documentHash: string | undefined;
  reviewId: string | undefined;
  apiKey: string;
  conversation: TranscriptMessage[];
}): Promise<ResolvedPaper> {
  const { userId, documentHash, reviewId, apiKey, conversation } = params;
  if (!documentHash || typeof documentHash !== "string") return {};
  const doc = await docs.getDocumentByHash(documentHash);
  if (!doc) return {};
  if (reviewId) await docs.linkReviewDocument(userId, reviewId, doc.id);

  const title = doc.title ?? undefined;
  if (!doc.text) return {};

  if (documentMode(doc.charCount) === "full") {
    return {
      agent: { paperContext: doc.text, documentTitle: title },
      block: { text: doc.text, title },
    };
  }

  if (doc.indexStatus !== "ready") {
    const note =
      doc.indexStatus === "failed"
        ? "This document is long and building its search index failed, so only the beginning of the text is in context."
        : "This document is long and its search index is still being built, so only the beginning of the text is in context for now.";
    const text = doc.text.slice(0, RETRIEVAL_THRESHOLD_CHARS);
    return {
      agent: { paperContext: text, paperNote: note, documentTitle: title },
      block: { text, note, title },
    };
  }

  const [retrieval, tableOfContents] = await Promise.all([
    retrieveContext({ documentId: doc.id, apiKey, conversation }),
    docs.tableOfContents(doc.id),
  ]);
  let meteredTokens =
    retrieval.rewriteTokens + retrieval.embedUsage.tokens * EMBEDDING_TOKEN_WEIGHT;
  const searchChunks = async (query: string, k: number) => {
    const [vector] = await embedTexts(apiKey, [query], (u) => {
      meteredTokens += u.tokens * EMBEDDING_TOKEN_WEIGHT;
    });
    return docs.searchChunks(doc.id, vector, k);
  };
  return {
    agent: {
      retrievedContext: retrieval.block,
      documentTitle: title,
      tableOfContents,
      searchChunks,
    },
    block: { retrieved: retrieval.block, title, tableOfContents },
    get meteredTokens() {
      return meteredTokens;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

/** NDJSON headers shared by the streaming response and the rate-limit reject. */
const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Transfer-Encoding": "chunked",
  "Cache-Control": "no-cache",
} as const;

/**
 * Build the model-facing transcript from the full history given a compaction
 * record. Drops the leading `coveredCount` messages the recap subsumes and
 * prepends the summary as a single context message. Returns the input
 * unchanged when there's no compaction or the boundary no longer lines up
 * (e.g. history was cleared), so a stale record can never strip live turns.
 * Non-destructive: the caller still persists the untouched full history.
 */
function applyCompaction(
  base: ChatMessage[],
  compaction: ContextMetadata["compaction"],
): ChatMessage[] {
  if (!compaction || compaction.coveredCount <= 0) return base;
  if (compaction.coveredCount >= base.length) return base;
  // Sanity-check the boundary still points at the message it summarized.
  if (base[compaction.coveredCount - 1]?.id !== compaction.coveredThroughId) {
    return base;
  }
  const summaryMsg: ChatMessage = {
    id: `compaction-${compaction.coveredThroughId}`,
    role: "user",
    content: `Summary of earlier conversation (for context):\n\n${compaction.summary}`,
    timestamp: compaction.createdAt,
  };
  return [summaryMsg, ...base.slice(compaction.coveredCount)];
}

/**
 * Reject a request that exceeded the platform token budget. Emits the same
 * in-stream `rate_limit` error the client already handles for upstream 429s,
 * so the UI shows its "add your own API key" prompt with no client
 * changes. Returned with HTTP 200 (the payload is the NDJSON stream) so the
 * client parses events rather than treating it as a transport failure.
 */
function rateLimitedResponse(): Response {
  const events: StreamEvent[] = [
    {
      type: "error",
      code: "rate_limit",
      message:
        "You've reached the current usage limit. Add your own API key for higher limits.",
    },
    { type: "done" },
  ];
  const body = events.map((e) => JSON.stringify(e) + "\n").join("");
  return new Response(body, { headers: NDJSON_HEADERS });
}

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const {
    messages,
    userMessage,
    userMessageId,
    assistantMessageId,
    resume,
    apiKey,
    documentHash,
    paperTitle,
    arxivId,
    reviewId,
    sourceUrl,
    exaApiKey,
    skipWebSearch,
    mode,
    discover,
  } = body;

  // Server-owned path: the main review chat sends a single `userMessage` + a
  // `reviewId` instead of the full transcript, and the server owns load /
  // persist / context-budgeting. Discover and the selection-thread chat keep
  // the legacy stateless `messages` array.
  const isStateful =
    mode !== "discover" &&
    typeof reviewId === "string" &&
    reviewId.length > 0 &&
    (typeof userMessage === "string" || resume === true);

  if (!isStateful && (!Array.isArray(messages) || messages.length === 0)) {
    return jsonError("Messages array is required and must not be empty.", 400);
  }

  // Resolve the Fireworks key, spending the user's free platform allowance
  // before falling back to their own key. `meter` is true only while we're on
  // the platform key — usage is charged to the user's buckets after the stream
  // (see the cache_stats accumulation below). This gates both the assistant and
  // discovery surfaces, since both run through this route. Never echoed back.
  let resolvedApiKey: string;
  let meter = false;
  let meterUserId: string | null = null;
  try {
    const outcome = await resolveMeteredKey(apiKey);
    if (!outcome.ok) {
      // Out of allowance with no personal key → surface the BYOK prompt the
      // client already renders for the upstream-429 path below.
      if (outcome.reason === "rate_limited") return rateLimitedResponse();
      return jsonError("API key is required.", 401);
    }
    resolvedApiKey = outcome.apiKey;
    meter = outcome.meter;
    meterUserId = outcome.userId;
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    throw err;
  }

  const trimmedExaKey =
    typeof exaApiKey === "string" ? exaApiKey.trim() : "";
  // The system prompt is resolved up front only to budget the conversation to
  // the context window below. Tool selection and the ToolContext are built
  // inside runReadingAgent so the route and the offline eval harness exercise
  // the exact same agent setup and can't drift.
  const systemPrompt = getReadingSystemPrompt(sourceUrl, mode);

  // Resolve the conversation to send the model. Server-owned path: load it
  // from the DB, append the new user turn, then budget it to the model's
  // context window. Persistence happens AFTER the stream (see below) so the
  // only pre-stream cost is auth + one history read — nothing blocks
  // time-to-first-token. Legacy path: the client supplied the transcript.
  let conversation: TranscriptMessage[];
  let persist: {
    userId: string;
    reviewId: string;
    base: ChatMessage[];
    priorMeta: ContextMetadata | null;
  } | null = null;
  // Context window; the emit loop reuses it for `context_usage` events.
  const windowTokens = getFireworksContextWindow();
  // Reuse the user already resolved during metered key resolution to avoid a
  // second session read on the pre-stream path.
  let userId: string;
  try {
    userId = meterUserId ?? (await requireUserId());
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    throw err;
  }

  // Resolve the paper from the document hash: full text, retrieved passages,
  // or a leading slice while indexing finishes. Retrieval spends a little on
  // the query embedding + rewrite; that's metered below with the stream.
  let paper: ResolvedPaper = {};
  let preTurnTokens = 0;
  // Server-owned path: the stored conversation, loaded once and reused below.
  let stored: Awaited<ReturnType<typeof store.getConversation>> | null = null;
  try {
    // The latest user turn drives retrieval for long documents, so the
    // conversation (prior turns + this message) is assembled before the
    // paper block. Server-owned path: load the stored history once here and
    // reuse it below; a resume / idempotent retry re-runs the stored last
    // user turn rather than appending a new one.
    let forRetrieval: TranscriptMessage[];
    if (isStateful) {
      stored = await store.getConversation(userId, reviewId!);
      const prior: TranscriptMessage[] = stored.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const last = stored.messages[stored.messages.length - 1];
      const reusesStored =
        resume || (last?.role === "user" && last.id === userMessageId);
      forRetrieval = reusesStored
        ? prior
        : [...prior, { role: "user", content: userMessage ?? "" }];
    } else {
      forRetrieval = messages!;
    }
    paper = await resolvePaper({
      userId,
      documentHash,
      reviewId,
      apiKey: resolvedApiKey,
      conversation: forRetrieval,
    });
    preTurnTokens = paper.meteredTokens ?? 0;
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    // Retrieval problems degrade to "no paper in context" rather than
    // failing the turn; the model will say it can't see the document.
    console.error("Paper resolution failed:", err);
    paper = {};
  }

  // Fixed (uncompactable) overhead, split out for the usage breakdown: the
  // paper block's footprint in context, plus the system prompt. Conversation
  // tokens are the measured total minus this.
  const paperTokens = estimateTokens(buildPaperBlock(paper.block) ?? "");
  const overheadTokens = paperTokens + estimateTokens(systemPrompt);
  if (isStateful) {
    try {
      const { messages: history, contextMetadata: priorMeta } = stored!;
      const last = history[history.length - 1];
      let base: ChatMessage[];
      if (resume || (last?.role === "user" && last.id === userMessageId)) {
        // Resume (Exa-key decision) or an idempotent retry: the user turn is
        // already stored. Re-run the existing history rather than duplicating.
        base = history;
      } else {
        const userMsg: ChatMessage = {
          id: userMessageId || crypto.randomUUID(),
          role: "user",
          content: userMessage ?? "",
          timestamp: new Date().toISOString(),
        };
        base = [...history, userMsg];
      }
      // `base` is the full history we persist (never mutated by compaction).
      persist = { userId, reviewId: reviewId!, base, priorMeta };

      // Compaction (non-destructive): if older turns were folded into a recap,
      // build the MODEL-facing transcript by dropping those covered messages
      // and prepending the summary. Storage keeps `base` intact.
      const modelBase = applyCompaction(base, priorMeta?.compaction);

      // Budget the conversation to fit the model's context window. Storage
      // keeps the full history; this only shapes what's sent to the model.
      // Window minus the prompt/paper overhead and fixed reserves is what's
      // left for history; never send less than the floor.
      const historyBudget =
        windowTokens -
        overheadTokens -
        TOKEN_RESERVE.RESPONSE -
        TOKEN_RESERVE.SAFETY;
      conversation = fitTranscriptToBudget(
        modelBase,
        Math.max(TOKEN_RESERVE.HISTORY_FLOOR, historyBudget),
      ).messages;
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err);
      throw err;
    }
  } else {
    conversation = messages!;
  }

  // History hygiene: past assistant turns may contain retired visual fences
  // (```chart / ```mermaid), and the model imitates its own prior output far
  // more reliably than it follows the prompt's ```diagram instruction.
  // Relabel them in the model-facing transcript only — storage keeps the
  // original, and the data stays in context so "redraw it" still works.
  conversation = conversation.map((m) =>
    m.role === "assistant"
      ? {
          ...m,
          content: retireLegacyVisualFences(m.content),
          blocks: m.blocks?.map((b) =>
            b.type === "text_segment"
              ? { ...b, content: retireLegacyVisualFences(b.content) }
              : b,
          ),
        }
      : m,
  );

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Accumulate the assistant turn server-side (server-owned path only) so
      // we can persist it on completion — same step logic the client renders.
      let steps: AgentStep[] = [];
      // Sum real token usage across every tool round for the reconcile below.
      // Seeded with the retrieval spend (query rewrite + embedding).
      let actualTokens = preTurnTokens;
      // Largest measured context size this turn (the last round is fullest),
      // persisted so the client meter is accurate after a refresh.
      let lastContextTokens = persist?.priorMeta?.lastContextTokens ?? 0;
      const emit = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* controller may be closed */
        }
        if (persist) steps = processStreamEvent(steps, event);
        if (event.type === "cache_stats") {
          // Cost-weighted: cache reads count at 10% (see meteredTokens).
          // cacheCreationTokens is omitted because it's always 0 for the
          // current provider (Fireworks/DeepSeek); revisit if an
          // Anthropic-style provider that reports cache-write tokens is ever
          // routed through this event.
          actualTokens += meteredTokens(
            event.inputTokens,
            event.cacheReadTokens,
            event.outputTokens,
          );
          // Surface the real context size (prompt tokens = uncached + cached)
          // so the client can render a usage meter and auto-compact. Only the
          // server-owned path has a conversation to compact.
          if (persist) {
            const used = event.inputTokens + event.cacheReadTokens;
            lastContextTokens = Math.max(lastContextTokens, used);
            emit({
              type: "context_usage",
              usedTokens: used,
              windowTokens,
              shouldCompact: computeShouldCompact(used, windowTokens),
              paperTokens,
              overheadTokens,
            });
          }
        }
      };

      try {
        await runReadingAgent({
          conversation,
          apiKey: resolvedApiKey,
          ...paper.agent,
          paperTitle,
          arxivId,
          reviewId,
          sourceUrl,
          exaApiKey: trimmedExaKey || undefined,
          skipWebSearch,
          mode,
          discover: mode === "discover" ? sanitizeDiscover(discover) : undefined,
          emit,
        });
      } catch (err) {
        const rateLimited = !!(err as { isRateLimit?: boolean })?.isRateLimit;
        emit(
          rateLimited
            ? {
                type: "error",
                code: "rate_limit",
                message:
                  "You've reached the current usage limit. Add your own API key for higher limits.",
              }
            : {
                type: "error",
                message: err instanceof Error ? err.message : "Unknown error",
              },
        );
      }

      // Follow-up `search_paper` calls embed their queries mid-stream; pick
      // up that spend now that the agent is done.
      actualTokens += (paper.meteredTokens ?? 0) - preTurnTokens;

      // Persist the turn (best-effort) AFTER streaming, so it never delays the
      // first token — this is also where the one Slack notification fires. The
      // user message is always written (the server didn't store it up front);
      // the assistant reply is appended only when the turn produced text, so
      // an Exa-key pause or hard error leaves just the user message and a
      // resume re-runs cleanly.
      if (persist) {
        const content = stepsToContent(steps);
        let finalMessages = persist.base;
        if (content.trim()) {
          const blocks = stepsToBlocks(steps);
          const assistantMsg: ChatMessage = {
            id: assistantMessageId || crypto.randomUUID(),
            role: "assistant",
            content,
            timestamp: new Date().toISOString(),
            ...(blocks.length > 0 ? { blocks } : {}),
          };
          finalMessages = [...persist.base, assistantMsg];
        }
        // Preserve any existing compaction record; refresh the measured
        // context size + window so the meter survives a reload.
        const nextMeta: ContextMetadata = {
          ...(persist.priorMeta ?? {}),
          lastContextTokens,
          windowTokens,
          paperTokens,
          overheadTokens,
        };
        try {
          await store.setMessages(
            persist.userId,
            persist.reviewId,
            finalMessages,
            nextMeta,
          );
        } catch (e) {
          // Non-fatal: the client already has the turn on screen. Worst case
          // it's missing on next load; better than failing the request.
          console.error("Failed to persist chat turn:", e);
        }
      }

      // Charge the real usage to the user's buckets (best-effort; the helper
      // swallows its own errors). A heavy turn can push the bucket negative,
      // which gates the next request until it refills.
      if (meter && meterUserId) {
        await charge(meterUserId, actualTokens);
      }

      emit({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}

/** Keep only well-formed funnel inputs from the request body: strings,
 *  bounded in length and count. The client builds these, but they flow into
 *  prompts and judge requests, so nothing unexpected gets through. */
function sanitizeDiscover(raw: ChatRequest["discover"]): DiscoverOptions {
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
  const list = (v: unknown, max: number) =>
    Array.isArray(v)
      ? v.flatMap((x) => (typeof x === "string" && x.trim() ? [x.trim().slice(0, 500)] : [])).slice(0, max)
      : [];
  return {
    question: str(raw?.question, 2000),
    projectName: str(raw?.projectName, 200) ?? null,
    exclude: {
      arxivIds: list(raw?.exclude?.arxivIds, 200),
      urls: list(raw?.exclude?.urls, 200),
    },
  };
}
