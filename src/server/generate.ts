/**
 * The app's single LLM generation entrypoint: build the system prompt (with the
 * paper wrapped in a `<paper>` block) and call OpenRouter's chat-completions
 * API, streaming or not.
 *
 * This is pure provider I/O — no auth, no rate-limit metering, no HTTP framing.
 * The `/api/generate` route wraps these functions with per-user key resolution
 * and budget metering; offline eval harnesses import and call them directly with
 * an OpenRouter key. Both paths therefore exercise the EXACT same prompt and
 * paper wrapping, with nothing re-implemented on either side.
 *
 * Deliberately free of any `server-only` / DB / Next-runtime imports so it runs
 * unchanged in a plain Node/tsx process (the evals) as well as in the route. The
 * billing math stays in the route, which is why these functions return the raw
 * provider `usage` object rather than a metered token count.
 */

import { parseApiErrorMessage } from "@/lib/api-utils";
import {
  OPENROUTER_BASE_URL,
  OPENROUTER_MODEL,
  type OpenRouterUsage,
} from "@/lib/openrouter";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

const OPENROUTER_CHAT_COMPLETIONS_URL = `${OPENROUTER_BASE_URL}/chat/completions`;

/**
 * Ceiling for a non-streaming generation, which returns only once the whole
 * completion is ready. Generous (a long answer over a big paper is fine) but
 * bounded, so a hung connection fails fast instead of parking the request — or,
 * in the eval, a worker — forever. Streaming has no such cap: a long stream is
 * legitimate and aborting mid-response would truncate it.
 */
const GENERATE_TIMEOUT_MS = 120_000;

const SYSTEM_PROMPT = `You are an expert AI research assistant helping a researcher understand an academic paper. Return only the content requested by the user prompt.

When asked to output JSON:
- Return valid JSON only
- Do not include markdown fences
- Do not include extra commentary`;

export function systemContentFor(paperContext?: string): string {
  return paperContext
    ? `${SYSTEM_PROMPT}\n\n<paper>\n${paperContext}\n</paper>`
    : SYSTEM_PROMPT;
}

/**
 * The single chat-completions request both paths send — identical body except
 * for streaming. Keeping it in one place means a change to headers, model, or
 * message wrapping can't drift between the streaming and non-streaming calls.
 */
function chatRequestInit(
  apiKey: string,
  prompt: string,
  paperContext: string | undefined,
  opts: { stream: boolean },
): RequestInit {
  return {
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
      stream: opts.stream,
      // Ask for the final usage chunk so a streaming caller can reconcile spend.
      ...(opts.stream ? { stream_options: { include_usage: true } } : {}),
    }),
  };
}

/**
 * Non-streaming generation. Returns the completion text plus the raw provider
 * usage (when present) so the caller can meter it however it likes.
 */
export async function generate(
  apiKey: string,
  prompt: string,
  paperContext?: string,
): Promise<{ content: string; usage?: OpenRouterUsage }> {
  const response = await fetchWithTimeout(
    OPENROUTER_CHAT_COMPLETIONS_URL,
    chatRequestInit(apiKey, prompt, paperContext, { stream: false }),
    GENERATE_TIMEOUT_MS,
  );

  if (!response.ok) throw await parseError(response);

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: OpenRouterUsage;
  };
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    usage: data.usage,
  };
}

export async function openStream(
  apiKey: string,
  prompt: string,
  paperContext?: string,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(
    OPENROUTER_CHAT_COMPLETIONS_URL,
    chatRequestInit(apiKey, prompt, paperContext, { stream: true }),
  );
  if (!response.ok) throw await parseError(response);
  if (!response.body) throw new Error("OpenRouter returned no stream body.");
  return response.body;
}

/**
 * Read SSE chunks from OpenRouter and emit just the text deltas as plain UTF-8
 * to the client. Closes when the upstream stream ends. `onComplete` fires once
 * at the end with the raw usage object from the final chunk (null if the
 * upstream never reported usage) so the caller can reconcile metered spend.
 */
export function transformSseToText(
  upstream: ReadableStream<Uint8Array>,
  onComplete?: (usage: OpenRouterUsage | null) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let usage: OpenRouterUsage | null = null;

  const handle = (evt: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
    const parsed = parseSseEvent(evt);
    if (parsed.text) controller.enqueue(encoder.encode(parsed.text));
    if (parsed.usage != null) usage = parsed.usage;
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
      onComplete?.(usage);
      controller.close();
    },
  });
}

/** Extract the text delta and (when present) the raw usage from one SSE event. */
function parseSseEvent(eventBlock: string): { text: string; usage: OpenRouterUsage | null } {
  let text = "";
  let usage: OpenRouterUsage | null = null;
  for (const line of eventBlock.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const data = JSON.parse(payload);
      const delta = data?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
      if (data?.usage) usage = data.usage;
    } catch {
      /* ignore malformed events */
    }
  }
  return { text, usage };
}

async function parseError(response: Response) {
  const errorText = await response.text();
  const fallback = `OpenRouter API error: ${response.status}`;
  return new Error(parseApiErrorMessage(errorText, fallback));
}
