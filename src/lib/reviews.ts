import {
  createReview as createReviewRemote,
  createLocalPdfReview as createLocalPdfReviewRemote,
  createWebReview as createWebReviewRemote,
  getReview as getReviewCached,
  getReviewsSnapshot,
  loadMessages,
  saveMessages,
} from "@/lib/client-data";
import type {
  ChatAssistantBlock,
  ChatMessage,
  PaperReview,
} from "@/lib/review-types";

export { REVIEWS_UPDATED_EVENT } from "@/lib/storage-events";

export type { ChatAssistantBlock, ChatMessage, PaperReview };

export function getReviews(): PaperReview[] {
  return getReviewsSnapshot();
}

export function getReview(id: string): PaperReview | undefined {
  return getReviewCached(id);
}

/** Canonical id for matching (lowercase, no version suffix). */
export function normalizeArxivId(raw: string): string {
  return raw.trim().toLowerCase().replace(/v\d+$/i, "");
}

export async function createReview(
  arxivId: string,
  title: string,
): Promise<PaperReview> {
  return createReviewRemote(arxivId, title);
}

export async function createLocalPdfReview(
  pdfPath: string,
  title: string,
): Promise<PaperReview> {
  return createLocalPdfReviewRemote(pdfPath, title);
}

export async function createWebReview(
  sourceUrl: string,
  title: string,
): Promise<PaperReview> {
  return createWebReviewRemote(sourceUrl, title);
}

export function getReviewByArxivId(arxivId: string): PaperReview | undefined {
  const key = normalizeArxivId(arxivId);
  return getReviewsSnapshot().find(
    (r) => r.arxivId != null && normalizeArxivId(r.arxivId) === key,
  );
}

/** Opens an existing review for this arXiv paper when present; otherwise creates one. */
export async function createOrGetReview(
  arxivId: string,
  title: string,
): Promise<PaperReview> {
  const existing = getReviewByArxivId(arxivId);
  if (existing) return existing;
  return createReview(arxivId, title);
}

export { loadMessages, saveMessages };
