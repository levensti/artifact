/**
 * Conversation compaction endpoint.
 *
 * Summarizes the older stretch of a server-owned review chat into a recap and
 * records it in `ReviewMessages.contextMetadata`. Non-destructive: the raw
 * `messages` are never touched — the chat route just swaps the covered turns
 * for the recap when building the model-facing transcript.
 *
 * Idempotent: if a prior compaction already covers up to the boundary, this is
 * a no-op. That makes a double auto-trigger, a manual+auto race, or a refresh
 * mid-compaction safe — none can double-summarize.
 *
 * Metered like `/api/generate`: it spends the user's platform allowance first
 * and falls back to their own key, so it can't bypass the chat limiter.
 */

import { NextRequest } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { requireUserId, HttpError, errorResponse } from "@/server/api";
import { resolveMeteredKey, charge, meteredTokens } from "@/server/rate-limit";
import { generate } from "@/server/generate";
import {
  computeShouldCompact,
  getOpenRouterContextWindow,
  type OpenRouterUsage,
} from "@/lib/openrouter";
import { estimateTokens } from "@/lib/transcript";
import * as store from "@/server/store";
import type {
  ChatMessage,
  CompactionRecord,
  ContextUsage,
} from "@/lib/review-types";

/**
 * Most recent messages always kept verbatim; everything older is summarized.
 * Just the latest exchange — compaction availability is driven by context
 * usage (see `computeShouldCompact`), not by a minimum turn count.
 */
const KEEP_RECENT = 2;

export async function POST(req: NextRequest) {
  let body: { reviewId?: string; apiKey?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const { reviewId, apiKey } = body;
  if (!reviewId || typeof reviewId !== "string") {
    return jsonError("reviewId is required.", 400);
  }

  // Spend the platform allowance first (metered), fall back to the user's key.
  let resolvedApiKey: string;
  let meter = false;
  let meterUserId: string | null = null;
  try {
    const outcome = await resolveMeteredKey(apiKey);
    if (!outcome.ok) {
      if (outcome.reason === "rate_limited") {
        return jsonError(
          "You've reached the current usage limit. Add your own OpenRouter key for higher limits.",
          429,
        );
      }
      return jsonError(
        "API key is required. Manage API keys in the app to add one.",
        401,
      );
    }
    resolvedApiKey = outcome.apiKey;
    meter = outcome.meter;
    meterUserId = outcome.userId;
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    throw err;
  }

  try {
    const userId = meterUserId ?? (await requireUserId());
    const { messages, contextMetadata } = await store.getConversation(
      userId,
      reviewId,
    );

    const windowTokens = getOpenRouterContextWindow();
    const coveredCount = messages.length - KEEP_RECENT;

    // Nothing old enough to fold in yet.
    if (coveredCount <= 0) {
      return Response.json({
        status: "noop",
        compaction: contextMetadata?.compaction ?? null,
        contextUsage: null,
      });
    }

    // Idempotency: a prior compaction already reaches this boundary or beyond.
    // The last measured size already reflects it, so report that as-is.
    const prior = contextMetadata?.compaction;
    if (prior && prior.coveredCount >= coveredCount) {
      const measured = contextMetadata?.lastContextTokens;
      return Response.json({
        status: "already",
        compaction: prior,
        contextUsage:
          measured && measured > 0
            ? {
                usedTokens: measured,
                windowTokens,
                shouldCompact: computeShouldCompact(measured, windowTokens),
                paperTokens: contextMetadata?.paperTokens,
                overheadTokens: contextMetadata?.overheadTokens,
              }
            : null,
      });
    }

    // Summarize the delta since the last boundary, carrying the prior recap so
    // the new one fully subsumes it (the boundary only moves forward).
    const priorCount = prior?.coveredCount ?? 0;
    const newlyCovered = messages.slice(priorCount, coveredCount);
    const prompt = buildCompactionPrompt(newlyCovered, prior?.summary);

    const { content, usage } = await generate(resolvedApiKey, prompt);
    if (meter && meterUserId) {
      await charge(meterUserId, usage ? usageTotal(usage) : 0);
    }
    const summary = content.trim();
    if (!summary) {
      return jsonError("Compaction produced an empty summary.", 502);
    }

    const compaction: CompactionRecord = {
      summary,
      coveredThroughId: messages[coveredCount - 1].id,
      coveredCount,
      createdAt: new Date().toISOString(),
    };
    await store.setContextMetadata(userId, reviewId, {
      ...(contextMetadata ?? {}),
      compaction,
    });

    return Response.json({
      status: "compacted",
      compaction,
      contextUsage: {
        ...estimatedUsage(
          messages,
          compaction,
          prior?.summary,
          priorCount,
          contextMetadata?.lastContextTokens,
          windowTokens,
        ),
        paperTokens: contextMetadata?.paperTokens,
        overheadTokens: contextMetadata?.overheadTokens,
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
}

/**
 * Estimate the model-facing context size after a compaction, for the meter
 * until the next real turn reports measured `prompt_tokens`. Projects from the
 * last MEASURED size (which includes the paper + system overhead the endpoint
 * can't see) by subtracting the history just folded away and adding the recap:
 *   measured − priorSummary − removedRawTurns + newSummary
 * Falls back to a raw lower bound when there's no measurement yet.
 */
function estimatedUsage(
  messages: ChatMessage[],
  compaction: CompactionRecord,
  priorSummary: string | undefined,
  priorCount: number,
  measured: number | undefined,
  windowTokens: number,
): ContextUsage {
  let usedTokens: number;
  if (measured && measured > 0) {
    const removedRaw = messages
      .slice(priorCount, compaction.coveredCount)
      .reduce((sum, m) => sum + estimateTokens(m.content), 0);
    usedTokens = Math.max(
      estimateTokens(compaction.summary),
      measured -
        estimateTokens(priorSummary ?? "") -
        removedRaw +
        estimateTokens(compaction.summary),
    );
  } else {
    const kept = messages.slice(compaction.coveredCount);
    usedTokens =
      estimateTokens(compaction.summary) +
      kept.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  }
  return {
    usedTokens,
    windowTokens,
    shouldCompact: computeShouldCompact(usedTokens, windowTokens),
  };
}

/**
 * Build the recap prompt from the messages being folded in, carrying any prior
 * recap so the result is a single complete summary. Note form, no commentary —
 * this is internal context, not user-facing prose.
 */
function buildCompactionPrompt(
  messages: ChatMessage[],
  priorSummary: string | undefined,
): string {
  const transcript = messages
    .filter((m) => m.content && m.content.trim().length > 0)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
  const priorBlock = priorSummary
    ? `Earlier summary (already condensed — fold this in):\n${priorSummary}\n\n`
    : "";
  return `You are compacting an ongoing conversation between a USER and an AI ASSISTANT about a research paper, to free up context space. Condense the material below into a concise recap that preserves: the questions the user asked, the conclusions reached, key facts/figures/definitions established, and any open threads still in play. Write in compact note form. Do not add commentary, preamble, or a sign-off — output only the recap.

${priorBlock}Conversation to condense:

${transcript}`;
}

/**
 * Tokens charged for one usage report, cost-weighted (see `meteredTokens`).
 * `prompt_tokens` includes the cached portion, so subtract it back out.
 */
function usageTotal(usage: OpenRouterUsage): number {
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncachedInput = Math.max(0, prompt - cached);
  return meteredTokens(uncachedInput, cached, completion);
}
