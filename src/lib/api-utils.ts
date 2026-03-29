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
 * error response body, falling back to a generic label.
 */
export function parseApiErrorMessage(
  responseText: string,
  fallback: string,
): string {
  try {
    const parsed = JSON.parse(responseText);
    return parsed.error?.message || fallback;
  } catch {
    return fallback;
  }
}
