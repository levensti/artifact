/**
 * `fetch` with a hard per-request timeout.
 *
 * The external APIs our tools call (Semantic Scholar, arXiv, Exa) can hang or
 * sit in long rate-limit backoffs. Without a ceiling, a single slow call can
 * block an agent round for 100+ seconds (observed in practice), and the whole
 * discovery run stalls. This wraps `fetch` with an `AbortController` so every
 * attempt fails fast instead, letting retry/fallback logic move on.
 */

const DEFAULT_TIMEOUT_MS = 25_000;

/** Thrown when a request exceeds its timeout, so callers can distinguish a
 *  timeout from a network error if they care. */
export class FetchTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    url: string,
  ) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
  }
}

/**
 * Like `fetch`, but aborts after `timeoutMs` (default 25s). An external
 * `signal` passed via `init` is respected too — either aborting wins.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Chain any caller-supplied signal so we don't clobber it.
  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else
      init.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted && !init.signal?.aborted) {
      throw new FetchTimeoutError(timeoutMs, url);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
