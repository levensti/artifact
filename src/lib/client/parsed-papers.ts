/**
 * Browser-side cache for parsed paper structures.
 *
 * Papers are parsed once (via /api/papers/parse) using the user's chosen
 * model+key, then cached server-side keyed by sha256 of the extracted text.
 * Re-opening the same paper hits the cache; chatting about it costs only
 * the per-turn tokens, not the parse.
 */

import type { Provider } from "@/lib/models";
import type { ParsedPaper } from "@/lib/review-types";
import { apiFetch } from "@/lib/client/api";

/**
 * Token-count threshold above which we switch from "send full text" to
 * "parse + send L1 summary + ToC". Conservative — caching makes mid-size
 * papers fine to send in full, but somewhere around 30k tokens (~120k
 * chars) the per-turn cost of always sending the full paper outweighs
 * the parse round-trip.
 */
export const LONG_PAPER_THRESHOLD_CHARS = 120_000;

export function isLongPaper(paperText: string | null | undefined): boolean {
  return !!paperText && paperText.length >= LONG_PAPER_THRESHOLD_CHARS;
}

/** sha256 of paper text, hex-encoded. Stable across sessions. */
export async function hashPaperText(paperText: string): Promise<string> {
  const data = new TextEncoder().encode(paperText);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCachedParsedPaper(
  hash: string,
): Promise<ParsedPaper | null> {
  const { parsed } = await apiFetch<{ parsed: ParsedPaper | null }>(
    `/api/parsed-papers/${encodeURIComponent(hash)}`,
  );
  return parsed;
}

export async function cacheParsedPaper(
  hash: string,
  parsed: ParsedPaper,
): Promise<void> {
  await apiFetch(`/api/parsed-papers/${encodeURIComponent(hash)}`, {
    method: "PUT",
    body: { parsed },
  });
}

interface ParseRequestPayload {
  paperText: string;
  model: string;
  provider: Provider;
  apiKey: string;
  apiBaseUrl?: string;
}

/** Call the parse endpoint and cache the result. */
export async function parseAndCachePaper(
  paperText: string,
  payload: Omit<ParseRequestPayload, "paperText">,
): Promise<ParsedPaper> {
  const hash = await hashPaperText(paperText);
  const cached = await getCachedParsedPaper(hash);
  if (cached) return cached;

  const response = await fetch("/api/papers/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperText, ...payload }),
  });
  if (!response.ok) {
    let message = `Paper parse failed: ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const parsed = (await response.json()) as ParsedPaper;
  await cacheParsedPaper(hash, parsed);
  return parsed;
}
