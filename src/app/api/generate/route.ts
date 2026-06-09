import { NextRequest } from "next/server";
import { jsonError, parseApiErrorMessage } from "@/lib/api-utils";
import { HttpError, errorResponse } from "@/server/api";
import { resolveMeteredKey, charge } from "@/server/rate-limit";
import { OPENROUTER_BASE_URL, OPENROUTER_MODEL } from "@/lib/openrouter";
import type { GenerateRequest } from "@/lib/explore";

const OPENROUTER_CHAT_COMPLETIONS_URL = `${OPENROUTER_BASE_URL}/chat/completions`;

const SYSTEM_PROMPT = `You are an expert AI research assistant helping a researcher understand an academic paper. Return only the content requested by the user prompt.

When asked to output JSON:
- Return valid JSON only
- Do not include markdown fences
- Do not include extra commentary`;

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
      const responseBody = transformSseToText(upstream, async (usageTokens) => {
        if (meter && meterUserId) {
          await charge(meterUserId, usageTokens);
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
    const { content, usageTokens } = await generate(
      resolvedApiKey,
      prompt,
      paperContext,
    );
    if (meter && meterUserId) {
      await charge(meterUserId, usageTokens);
    }
    return new Response(JSON.stringify({ content }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
}

function systemContentFor(paperContext?: string): string {
  return paperContext
    ? `${SYSTEM_PROMPT}\n\n<paper>\n${paperContext}\n</paper>`
    : SYSTEM_PROMPT;
}

async function openStream(
  apiKey: string,
  prompt: string,
  paperContext?: string,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: systemContentFor(paperContext) },
        { role: "user", content: prompt },
      ],
      stream: true,
      // Ask for the final usage chunk so the caller can reconcile real spend.
      stream_options: { include_usage: true },
    }),
  });
  if (!response.ok) throw await parseError(response);
  if (!response.body) throw new Error("OpenRouter returned no stream body.");
  return response.body;
}

/**
 * Read SSE chunks from OpenRouter and emit just the text deltas as plain
 * UTF-8 to the client. Closes when the upstream stream ends. `onComplete`
 * fires once at the end with the total tokens from the usage chunk (0 if the
 * upstream never reported usage) so the caller can reconcile metered spend.
 */
function transformSseToText(
  upstream: ReadableStream<Uint8Array>,
  onComplete?: (usageTokens: number) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let usageTokens = 0;

  const handle = (evt: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
    const { text, usage } = parseSseEvent(evt);
    if (text) controller.enqueue(encoder.encode(text));
    if (usage != null) usageTokens = usage;
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE events are separated by blank lines.
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const evt of events) handle(evt, controller);
        }
        if (buffer.trim()) handle(buffer, controller);
      } catch (err) {
        controller.error(err);
        return;
      } finally {
        reader.releaseLock();
      }
      onComplete?.(usageTokens);
      controller.close();
    },
  });
}

/** Extract the text delta and (when present) the usage total from one SSE event. */
function parseSseEvent(eventBlock: string): { text: string; usage: number | null } {
  let text = "";
  let usage: number | null = null;
  for (const line of eventBlock.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const data = JSON.parse(payload);
      const delta = data?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
      if (data?.usage) usage = usageTotal(data.usage);
    } catch {
      /* ignore malformed events */
    }
  }
  return { text, usage };
}

/** Total tokens processed = prompt (incl. cached) + completion. */
function usageTotal(usage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}): number {
  if (typeof usage.total_tokens === "number") return usage.total_tokens;
  return (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
}

async function generate(
  apiKey: string,
  prompt: string,
  paperContext?: string,
): Promise<{ content: string; usageTokens: number }> {
  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: systemContentFor(paperContext) },
        { role: "user", content: prompt },
      ],
      stream: false,
    }),
  });

  if (!response.ok) throw await parseError(response);

  const data = await response.json();
  return {
    content: data?.choices?.[0]?.message?.content ?? "",
    usageTokens: data?.usage ? usageTotal(data.usage) : 0,
  };
}

async function parseError(response: Response) {
  const errorText = await response.text();
  const fallback = `OpenRouter API error: ${response.status}`;
  return new Error(parseApiErrorMessage(errorText, fallback));
}
