import { NextRequest } from "next/server";
import { jsonError, parseApiErrorMessage } from "@/lib/api-utils";
import { resolveOpenRouterKey } from "@/server/provider-env";
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

  const resolvedApiKey = resolveOpenRouterKey(apiKey);
  if (!resolvedApiKey) {
    return jsonError(
      "API key is required. Manage API keys in the app to add one.",
      401,
    );
  }

  if (stream) {
    try {
      const upstream = await openStream(resolvedApiKey, prompt, paperContext);
      const responseBody = transformSseToText(upstream);
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
    const content = await generate(resolvedApiKey, prompt, paperContext);
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
    }),
  });
  if (!response.ok) throw await parseError(response);
  if (!response.body) throw new Error("OpenRouter returned no stream body.");
  return response.body;
}

/**
 * Read SSE chunks from OpenRouter and emit just the text deltas as plain
 * UTF-8 to the client. Closes when the upstream stream ends.
 */
function transformSseToText(
  upstream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

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
          for (const evt of events) {
            const text = parseSseEventText(evt);
            if (text) controller.enqueue(encoder.encode(text));
          }
        }
        if (buffer.trim()) {
          const text = parseSseEventText(buffer);
          if (text) controller.enqueue(encoder.encode(text));
        }
      } catch (err) {
        controller.error(err);
        return;
      } finally {
        reader.releaseLock();
      }
      controller.close();
    },
  });
}

function parseSseEventText(eventBlock: string): string {
  let text = "";
  for (const line of eventBlock.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const data = JSON.parse(payload);
      const delta = data?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
    } catch {
      /* ignore malformed events */
    }
  }
  return text;
}

async function generate(
  apiKey: string,
  prompt: string,
  paperContext?: string,
): Promise<string> {
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
  return data?.choices?.[0]?.message?.content ?? "";
}

async function parseError(response: Response) {
  const errorText = await response.text();
  const fallback = `OpenRouter API error: ${response.status}`;
  return new Error(parseApiErrorMessage(errorText, fallback));
}
