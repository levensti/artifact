/**
 * Review bundle export. Walks the Dexie fan-out for a single review and
 * assembles a JSON envelope that can be written to disk.
 *
 * Deliberately excluded from the bundle:
 *   • The PDF blob — recipient re-fetches from arxivId / sourceUrl.
 *   • The global merged graph — cross-review aggregate, not owned here.
 *   • Settings / API keys — privacy-critical.
 *   • Wiki pages — a separate bundle type.
 */

import type { PaperReview } from "@/lib/review-types";
import * as store from "@/lib/client/store";
import {
  bundleFilename,
  CURRENT_SCHEMA_VERSION,
  type ReviewBundle,
} from "./bundle-format";
import { triggerDownload } from "./download";

/** True if a review carries enough metadata to be re-fetched by a recipient. */
export function canShareReview(review: PaperReview): boolean {
  return Boolean(review.arxivId || review.sourceUrl);
}

/** Build a bundle in memory from the current Dexie state. */
export async function buildReviewBundle(
  reviewId: string,
): Promise<ReviewBundle> {
  const review = await store.getReview(reviewId);
  if (!review) {
    throw new Error(`buildReviewBundle: review not found: ${reviewId}`);
  }
  if (!canShareReview(review)) {
    throw new Error(
      "buildReviewBundle: locally-uploaded PDFs cannot be shared",
    );
  }

  // Strip the importedAt marker on the sharer's side: the recipient will
  // stamp their own when they import this bundle.
  const { importedAt: _importedAt, ...exportReview } = review;
  void _importedAt;

  // pdfPath is meaningless off this machine — scrub it so the recipient
  // falls back to arxivId/sourceUrl fetch paths even if their browser
  // happens to have a blob at the same id.
  const scrubbedReview: PaperReview = {
    ...exportReview,
    pdfPath: null,
  };

  const [messages, annotations, prerequisites, graph, allDeepDives] =
    await Promise.all([
      store.getMessages(reviewId),
      store.getAnnotations(reviewId),
      store.getPrerequisites(reviewId),
      store.getGraphData(reviewId),
      store.listDeepDives(),
    ]);

  const deepDives = allDeepDives.filter((d) => d.reviewId === reviewId);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    type: "review",
    exportedAt: new Date().toISOString(),
    data: {
      review: scrubbedReview,
      messages,
      annotations,
      deepDives,
      prerequisites,
      graph,
    },
  };
}

/** Build + trigger a browser download. Top-level handler for the Share button. */
export async function exportReviewToFile(reviewId: string): Promise<void> {
  const bundle = await buildReviewBundle(reviewId);
  const json = JSON.stringify(bundle, null, 2);
  triggerDownload(
    bundleFilename("review", bundle.data.review.title),
    json,
    "application/json",
  );
}
