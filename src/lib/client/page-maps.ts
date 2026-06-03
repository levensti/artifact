/**
 * Browser-side cache for citation-to-page maps.
 *
 * Mirrors `parsed-papers.ts` but for the lightweight page map only. The
 * map is keyed by sha256 of the extracted text, so re-opening the same
 * paper hits the cache and skips the LLM call.
 */

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
  /** Optional per-user OpenRouter key override. */
  apiKey?: string;
}

export type PageMapProgress = (done: number, total: number) => void;

/**
 * Return the cached page map for `paperText` if present; otherwise call
 * `/api/papers/page-map` to produce one, cache it, and return it.
 *
 * The endpoint streams NDJSON progress events as each page completes —
 * `onProgress` (if provided) is invoked with `(done, total)` so callers
 * can drive a determinate loading bar.
 */
export async function fetchAndCachePageMap(
  paperText: string,
  payload: Omit<PageMapRequestPayload, "paperText">,
  onProgress?: PageMapProgress,
): Promise<PageMap> {
  const hash = await hashPaperText(paperText);
  const cached = await getCachedPageMap(hash);
  if (cached) return cached;

  const response = await fetch("/api/papers/page-map", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperText, ...payload }),
  });
  if (!response.ok || !response.body) {
    let message = `Page map fetch failed: ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let map: PageMap | null = null;
  let serverError: string | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        try {
          const evt = JSON.parse(line) as
            | { type: "init"; total: number }
            | { type: "progress"; done: number; total: number }
            | { type: "result"; map: PageMap }
            | { type: "error"; error: string };
          if (evt.type === "init") onProgress?.(0, evt.total);
          else if (evt.type === "progress") onProgress?.(evt.done, evt.total);
          else if (evt.type === "result") map = evt.map;
          else if (evt.type === "error") serverError = evt.error;
        } catch {
          /* skip malformed line */
        }
      }
      nl = buffer.indexOf("\n");
    }

    if (done) break;
  }

  if (serverError) throw new Error(serverError);
  if (!map) throw new Error("Page map stream ended without a result.");

  await cachePageMap(hash, map);
  return map;
}
