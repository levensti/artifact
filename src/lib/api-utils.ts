/**
 * Shared helpers for Next.js API routes.
 */

/** Return a JSON error response with a standard shape: `{ error: string }`. */
export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Attempt to extract a human-readable error message from a provider API
 * error response body. Handles several common shapes:
 *   { error: { message: "..." } }   (OpenAI, Anthropic, xAI)
 *   { error: "..." }                 (Ollama and many OpenAI-compatible servers)
 *   { message: "..." }               (some proxies)
 * Falls back to a trimmed snippet of the raw body when nothing matches —
 * better to show "Forbidden" or a Cloudflare error page than a generic label.
 */
export function parseApiErrorMessage(
  responseText: string,
  fallback: string,
): string {
  const trimmed = responseText.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed?.error?.message === "string") return parsed.error.message;
    if (typeof parsed?.error === "string") return parsed.error;
    if (typeof parsed?.message === "string") return parsed.message;
  } catch {
    // Non-JSON body (HTML error page, plain text). Fall through.
  }
  // Surface a short snippet of the raw body so problems like a Cloudflare
  // 403 page or Ollama "Forbidden" string aren't hidden behind the fallback.
  const isHtml = /^\s*<(?:!doctype|html|head|body)/i.test(trimmed);
  if (isHtml) return fallback;
  const snippet = trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
  return `${fallback}: ${snippet}`;
}
