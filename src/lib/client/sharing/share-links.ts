/**
 * Client wrappers for the share-link API. Mirror server return shapes
 * from src/server/shares.ts so the client gets typed responses without
 * crossing the server-only boundary directly.
 */

import { apiFetch } from "@/lib/client/api";
import type { PaperReview } from "@/lib/review-types";

export type ShareKind = "review" | "wiki";

/**
 * Whether a review can be shared. Locally-uploaded PDFs can't —
 * recipients re-fetch the source from arxivId / sourceUrl, and there's
 * no way to do that for a private filesystem path.
 */
export function canShareReview(review: PaperReview): boolean {
  return Boolean(review.arxivId || review.sourceUrl);
}

export interface CreateShareResult {
  token: string;
  createdAt: string;
  reused: boolean;
}

export interface ImportShareResult {
  kind: ShareKind;
  finalReviewId?: string;
  importedSlugs?: string[];
  alreadyOwner?: boolean;
}

export interface ShareSummary {
  token: string;
  kind: ShareKind;
  createdAt: string;
  revokedAt: string | null;
  lastAccessAt: string | null;
  accessCount: number;
  target: { reviewId?: string; wikiSlug?: string; title: string | null };
}

interface CreateReviewShareInput {
  kind: "review";
  reviewId: string;
}

interface CreateWikiShareInput {
  kind: "wiki";
  wikiSlug: string;
  /** 0 = root only (default). Clamped to [0, 3] server-side. */
  wikiDepth?: number;
}

export type CreateShareInput = CreateReviewShareInput | CreateWikiShareInput;

export async function createShareLink(
  input: CreateShareInput,
): Promise<CreateShareResult> {
  return apiFetch<CreateShareResult>("/api/shares", {
    method: "POST",
    body: input,
  });
}

export async function listShareLinks(): Promise<ShareSummary[]> {
  const { shares } = await apiFetch<{ shares: ShareSummary[] }>("/api/shares");
  return shares;
}

export async function revokeShareLink(token: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(
    `/api/shares/${encodeURIComponent(token)}`,
    { method: "DELETE" },
  );
}

export async function importShareLink(token: string): Promise<ImportShareResult> {
  return apiFetch<ImportShareResult>(
    `/api/shares/${encodeURIComponent(token)}/import`,
    { method: "POST" },
  );
}

/**
 * Build the absolute share URL for a token. Kind picks the prefix
 * (`/share-review/...` vs `/share-journal/...`) so unfurls describe
 * what's inside without having to fetch metadata.
 */
export function buildShareUrl(token: string, kind: ShareKind): string {
  const segment = kind === "wiki" ? "share-journal" : "share-review";
  const path = `/${segment}/${token}`;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}
