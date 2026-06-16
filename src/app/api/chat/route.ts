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
import { OPENROUTER_CONTEXT_WINDOW } from "@/lib/openrouter";
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
import { resolveMeteredKey, charge, meteredTokens } from "@/server/rate-limit";
import * as store from "@/server/store";
import { buildPaperBlock } from "./paper-block";
import { getReadingSystemPrompt, runReadingAgent } from "@/server/reading-agent";
import type { ChatMessage, ParsedPaper } from "@/lib/review-types";

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
  /** Optional per-user OpenRouter key override. Server falls back to env. */
  apiKey?: string;
  /**
   * Full paper text. For short papers (<~30k tokens) the browser sends this
   * and the agent works directly off it. For long papers, the browser sends
   * `parsedPaper` instead and the agent fetches sections on demand via tools.
   */
  paperContext?: string;
  /**
   * Structured paper representation (L1 summary, sections, references). Sent
   * for long papers in place of `paperContext`. When present, the chat handler
   * puts only the summary + table of contents in the system prompt and
   * exposes `read_section` / `search_paper` / `lookup_citation` for detail.
   */
  parsedPaper?: ParsedPaper;
  paperTitle?: string;
  arxivId?: string;
  reviewId?: string;
  /** Set when the review is for an arbitrary web page rather than a paper/PDF. */
  sourceUrl?: string;
  /**
   * Selects which system prompt and tool subset to use. Default is the
   * paper/web reading agent. `"discover"` swaps in a discovery-focused
   * prompt and (since there's no paper context) only registers
   * `arxiv_search` and `web_search` — paper-internal tools are already
   * gated by `parsedPaper` so they self-disable in this mode.
   */
  mode?: "discover";
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
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

/** NDJSON headers shared by the streaming response and the rate-limit reject. */
const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Transfer-Encoding": "chunked",
  "Cache-Control": "no-cache",
} as const;

/**
 * Reject a request that exceeded the platform token budget. Emits the same
 * in-stream `rate_limit` error the client already handles for upstream 429s,
 * so the UI shows its "add your own OpenRouter key" prompt with no client
 * changes. Returned with HTTP 200 (the payload is the NDJSON stream) so the
 * client parses events rather than treating it as a transport failure.
 */
function rateLimitedResponse(): Response {
  const events: StreamEvent[] = [
    {
      type: "error",
      code: "rate_limit",
      message:
        "You've reached the current usage limit. Add your own OpenRouter key for higher limits.",
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
    paperContext,
    parsedPaper,
    paperTitle,
    arxivId,
    reviewId,
    sourceUrl,
    exaApiKey,
    skipWebSearch,
    mode,
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

  // Resolve the OpenRouter key, spending the user's free platform allowance
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
  let persist: { userId: string; reviewId: string; base: ChatMessage[] } | null =
    null;
  if (isStateful) {
    try {
      // Reuse the user already resolved during metered key resolution to avoid
      // a second session read on the pre-stream path.
      const userId = meterUserId ?? (await requireUserId());
      const history = await store.getMessages(userId, reviewId!);
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
      persist = { userId, reviewId: reviewId!, base };

      // Budget the conversation to fit the model's context window. Storage
      // keeps the full history; this only shapes what's sent to the model.
      const paperBlock = buildPaperBlock(paperContext, parsedPaper) ?? "";
      const overhead =
        estimateTokens(systemPrompt) + estimateTokens(paperBlock) + 2_000;
      const historyBudget =
        OPENROUTER_CONTEXT_WINDOW - 16_384 - overhead - 2_000;
      conversation = fitTranscriptToBudget(
        base,
        Math.max(4_000, historyBudget),
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
      let actualTokens = 0;
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
          // current provider (OpenRouter/DeepSeek); revisit if an
          // Anthropic-style provider that reports cache-write tokens is ever
          // routed through this event.
          actualTokens += meteredTokens(
            event.inputTokens,
            event.cacheReadTokens,
            event.outputTokens,
          );
        }
      };

      try {
        await runReadingAgent({
          conversation,
          apiKey: resolvedApiKey,
          paperContext,
          parsedPaper,
          paperTitle,
          arxivId,
          reviewId,
          sourceUrl,
          exaApiKey: trimmedExaKey || undefined,
          skipWebSearch,
          mode,
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
                  "You've reached the current usage limit. Add your own OpenRouter key for higher limits.",
              }
            : {
                type: "error",
                message: err instanceof Error ? err.message : "Unknown error",
              },
        );
      }

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
        try {
          await store.setMessages(
            persist.userId,
            persist.reviewId,
            finalMessages,
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
