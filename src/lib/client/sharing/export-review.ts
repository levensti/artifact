/**
 * Review bundle export. The server assembles the bundle from Postgres in
 * one round-trip; the client just downloads the JSON.
 *
 * Deliberately excluded from the bundle:
 *   • The PDF blob — recipient re-fetches from arxivId / sourceUrl.
 *   • Settings / API keys — privacy-critical.
 *   • Wiki pages — a separate bundle type.
 */

import type { PaperReview } from "@/lib/review-types";
import { apiFetch } from "@/lib/client/api";
import { bundleFilename, type ReviewBundle } from "./bundle-format";
import { triggerDownload } from "./download";

export function canShareReview(review: PaperReview): boolean {
  return Boolean(review.arxivId || review.sourceUrl);
}

export async function buildReviewBundle(reviewId: string): Promise<ReviewBundle> {
  const { bundle } = await apiFetch<{ bundle: ReviewBundle }>(
    `/api/export/review/${encodeURIComponent(reviewId)}`,
  );
  return bundle;
}

export async function exportReviewToFile(reviewId: string): Promise<void> {
  const bundle = await buildReviewBundle(reviewId);
  triggerDownload(
    bundleFilename("review", bundle.data.review.title),
    JSON.stringify(bundle, null, 2),
    "application/json",
  );
}
