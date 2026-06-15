import { NextRequest } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { HttpError, errorResponse } from "@/server/api";
import { resolveMeteredKey, charge, meteredTokens } from "@/server/rate-limit";
import { generate, openStream, transformSseToText } from "@/server/generate";
import type { OpenRouterUsage } from "@/lib/openrouter";
import type { GenerateRequest } from "@/lib/explore";

export async function POST(req: NextRequest) {
  let body: GenerateRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { apiKey, prompt, paperContext, stream } = body;

  if (!prompt || typeof prompt !== "string") {
    return jsonError("Prompt is required.", 400);
  }
  if (paperContext && paperContext.length > 500_000) {
    return jsonError("Request payload too large.", 413);
  }

  // Resolve the OpenRouter key, spending the user's free platform allowance
  // first (metered) and falling back to their own key once it's spent. Gating
  // this endpoint too keeps it from bypassing the chat limiter on the same
  // per-user budget.
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

  if (stream) {
    try {
      const upstream = await openStream(resolvedApiKey, prompt, paperContext);
      // Charge real usage once the upstream stream closes, using the usage
      // chunk it emits last. Awaited before the stream closes (not fire-and-
      // forget) so the charge reliably lands on serverless, where post-close
      // work can be dropped; the cost is one Redis call after the last byte.
      const responseBody = transformSseToText(upstream, async (usage) => {
        if (meter && meterUserId) {
          await charge(meterUserId, usage ? usageTotal(usage) : 0);
        }
      });
      return new Response(responseBody, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
          "Cache-Control": "no-cache",
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return jsonError(message, 500);
    }
  }

  try {
    const { content, usage } = await generate(resolvedApiKey, prompt, paperContext);
    if (meter && meterUserId) {
      await charge(meterUserId, usage ? usageTotal(usage) : 0);
    }
    return new Response(JSON.stringify({ content }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
}

/**
 * Tokens charged for one usage report, cost-weighted: full-rate uncached input
 * and completion, cache reads discounted (see `meteredTokens`). `prompt_tokens`
 * includes the cached portion, so subtract it back out to get uncached input.
 */
function usageTotal(usage: OpenRouterUsage): number {
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncachedInput = Math.max(0, prompt - cached);
  return meteredTokens(uncachedInput, cached, completion);
}
