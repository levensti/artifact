/**
 * Shared Semantic Scholar (S2) request config.
 *
 * Every S2 call (`arxiv_search` primary path, `paper_details`, the
 * `lookup_citation` abstract fetch) goes through here so they share one auth
 * story. Without `SEMANTIC_SCHOLAR_API_KEY` set, requests use the shared
 * UNAUTHENTICATED pool — roughly 1 request/second across every anonymous
 * caller globally — which throttles hard (observed: single search calls taking
 * 13–28s on 429-retry backoff, dominating discovery-run latency). With a key,
 * S2 grants a dedicated rate limit and these calls drop to ~1–2s.
 *
 * Get a free key: https://www.semanticscholar.org/product/api#api-key
 */

export const SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1";

/** Headers for a Semantic Scholar request, including the API key when one is
 *  configured. Server-only (reads `process.env`). */
export function semanticScholarHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Artifact/1.0 (academic research tool)",
  };
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;
  return headers;
}
