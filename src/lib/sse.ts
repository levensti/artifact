/**
 * Shared SSE line reader — extracts parsed JSON objects from an SSE stream.
 *
 * Both the Anthropic and OpenAI handlers were duplicating identical
 * ReadableStream → TextDecoder → buffer → "data:" line → JSON.parse logic.
 * This utility centralises that boilerplate.
 */

/**
 * Reads an SSE stream and calls `onData` for every successfully parsed
 * JSON payload (lines starting with `data: `).  Skips `[DONE]` sentinels
 * and malformed lines.
 */
export async function readSSEStream<T = unknown>(
  body: ReadableStream<Uint8Array>,
  onData: (data: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          onData(JSON.parse(data) as T);
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
