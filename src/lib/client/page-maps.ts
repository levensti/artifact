/**
 * Browser-side cache for citation-to-page maps.
 *
 * Mirrors `parsed-papers.ts` but for the lightweight page map only. The
 * map is keyed by sha256 of the extracted text, so re-opening the same
 * paper hits the cache and skips the LLM call.
 */

import type { Provider } from "@/lib/models";
import type { PageMap } from "@/lib/review-types";
import { apiFetch } from "@/lib/client/api";
import {
  hashPaperText,
  LONG_PAPER_THRESHOLD_CHARS,
} from "@/lib/client/parsed-papers";

/**
 * Char-count threshold above which we skip the page-map LLM call.
 * Locked to `LONG_PAPER_THRESHOLD_CHARS` so the two paths are
 * complementary: short papers get a page map (no full parse), long
 * papers get a full parse (no page map). Avoids paying both LLM costs
 * in an overlap window.
 */
export const PAGE_MAP_MAX_CHARS = LONG_PAPER_THRESHOLD_CHARS;

export async function getCachedPageMap(
  hash: string,
): Promise<PageMap | null> {
  const { map } = await apiFetch<{ map: PageMap | null }>(
    `/api/page-maps/${encodeURIComponent(hash)}`,
  );
  return map;
}

export async function cachePageMap(
  hash: string,
  map: PageMap,
): Promise<void> {
  await apiFetch(`/api/page-maps/${encodeURIComponent(hash)}`, {
    method: "PUT",
    body: { map },
  });
}

interface PageMapRequestPayload {
  paperText: string;
  model: string;
  provider: Provider;
  apiKey: string;
  apiBaseUrl?: string;
}

/**
 * Return the cached page map for `paperText` if present; otherwise call
 * `/api/papers/page-map` to produce one, cache it, and return it.
 */
export async function fetchAndCachePageMap(
  paperText: string,
  payload: Omit<PageMapRequestPayload, "paperText">,
): Promise<PageMap> {
  const hash = await hashPaperText(paperText);
  const cached = await getCachedPageMap(hash);
  if (cached) return cached;

  const response = await fetch("/api/papers/page-map", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperText, ...payload }),
  });
  if (!response.ok) {
    let message = `Page map fetch failed: ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const map = (await response.json()) as PageMap;
  await cachePageMap(hash, map);
  return map;
}
