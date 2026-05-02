/**
 * Bundle import pipeline.
 *
 * Validates an untrusted JSON blob locally for fast feedback (preview
 * dialog), then sends approved bundles to the server-side commit endpoints
 * which write to Postgres atomically.
 *
 * Policy decisions:
 *   • Review collision default → "copy"  (new id, rewrite references)
 *   • Wiki collision default  → "skip"  (don't clobber the recipient's notes)
 *   • PDFs are never in the bundle — imported reviews re-fetch from
 *     arxivId/sourceUrl through the app's existing fetch paths.
 */

import { apiFetch } from "@/lib/client/api";
import {
  getReviewsSnapshot,
  invalidateWikiCache,
  loadWikiPages,
  refreshReviews,
} from "@/lib/client-data";
import { normalizeArxivId } from "@/lib/arxiv";
import {
  validateBundle,
  type AnyBundle,
  type ReviewBundle,
  type WikiBundle,
} from "./bundle-format";

export type ReviewCollisionStrategy = "copy" | "skip" | "overwrite";
export type WikiCollisionStrategy = "skip" | "overwrite" | "rename";

export interface ReviewPreview {
  kind: "review";
  bundle: ReviewBundle;
  /** A review with the same id already exists locally. */
  idExists: boolean;
  /** A review with the same arxivId/sourceUrl already exists locally (may differ in id). */
  duplicateOfExistingId: string | null;
  counts: { messages: number; annotations: number; deepDives: number };
  notes: string[];
}

export interface WikiPreview {
  kind: "wiki";
  bundle: WikiBundle;
  pagesTotal: number;
  collidingSlugs: string[];
  newSlugs: string[];
}

export type BundlePreview = ReviewPreview | WikiPreview;

export interface ParseResult {
  ok: boolean;
  preview?: BundlePreview;
  error?: string;
}

/* ─── Phase 1: parse + validate + summarize ────────────────────── */

export async function previewBundleFromText(text: string): Promise<ParseResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = validateBundle(raw);
  if (!result.ok || !result.bundle) {
    return { ok: false, error: `Bundle failed validation:\n${result.issues.join("\n")}` };
  }

  return result.bundle.type === "review"
    ? { ok: true, preview: summarizeReview(result.bundle) }
    : { ok: true, preview: await summarizeWiki(result.bundle) };
}

function summarizeReview(bundle: ReviewBundle): ReviewPreview {
  const reviews = getReviewsSnapshot();
  const existingById = reviews.find((r) => r.id === bundle.data.review.id);

  let duplicateOfExistingId: string | null = null;
  if (!existingById) {
    const arxivId = bundle.data.review.arxivId;
    if (arxivId) {
      const target = normalizeArxivId(arxivId);
      const hit = reviews.find(
        (r) => r.arxivId && normalizeArxivId(r.arxivId) === target,
      );
      if (hit) duplicateOfExistingId = hit.id;
    }
    if (!duplicateOfExistingId && bundle.data.review.sourceUrl) {
      const hit = reviews.find((r) => r.sourceUrl === bundle.data.review.sourceUrl);
      if (hit) duplicateOfExistingId = hit.id;
    }
  }

  const notes: string[] = [];
  if (bundle.data.review.sourceUrl) {
    notes.push(
      "Highlights on web articles may shift if the source page has changed since the original review.",
    );
  }

  return {
    kind: "review",
    bundle,
    idExists: !!existingById,
    duplicateOfExistingId,
    counts: {
      messages: bundle.data.messages.length,
      annotations: bundle.data.annotations.length,
      deepDives: bundle.data.deepDives.length,
    },
    notes,
  };
}

async function summarizeWiki(bundle: WikiBundle): Promise<WikiPreview> {
  const pages = await loadWikiPages();
  const known = new Set(pages.map((p) => p.slug));
  const collidingSlugs: string[] = [];
  const newSlugs: string[] = [];
  for (const page of bundle.data.pages) {
    (known.has(page.slug) ? collidingSlugs : newSlugs).push(page.slug);
  }
  return {
    kind: "wiki",
    bundle,
    pagesTotal: bundle.data.pages.length,
    collidingSlugs,
    newSlugs,
  };
}

/* ─── Phase 2: commit ──────────────────────────────────────────── */

export interface ReviewCommitResult {
  finalReviewId: string;
  skipped: boolean;
}

export async function commitReviewBundle(
  bundle: ReviewBundle,
  strategy: ReviewCollisionStrategy = "copy",
): Promise<ReviewCommitResult> {
  const result = await apiFetch<ReviewCommitResult>(
    "/api/import/review-bundle",
    { method: "POST", body: { bundle, strategy } },
  );
  await refreshReviews();
  return result;
}

export interface WikiCommitResult {
  imported: number;
  skipped: number;
  renamed: number;
}

export async function commitWikiBundle(
  bundle: WikiBundle,
  strategy: WikiCollisionStrategy = "skip",
): Promise<WikiCommitResult> {
  const result = await apiFetch<WikiCommitResult>(
    "/api/import/wiki-bundle",
    { method: "POST", body: { bundle, strategy } },
  );
  invalidateWikiCache();
  return result;
}

export async function importBundleFromText(text: string): Promise<{
  ok: boolean;
  error?: string;
  bundle?: AnyBundle;
  result?: ReviewCommitResult | WikiCommitResult;
}> {
  const parsed = await previewBundleFromText(text);
  if (!parsed.ok || !parsed.preview) return { ok: false, error: parsed.error };
  const preview = parsed.preview;
  if (preview.kind === "review") {
    const result = await commitReviewBundle(preview.bundle);
    return { ok: true, bundle: preview.bundle, result };
  }
  const result = await commitWikiBundle(preview.bundle);
  return { ok: true, bundle: preview.bundle, result };
}
