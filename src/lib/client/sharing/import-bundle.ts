/**
 * Bundle import pipeline.
 *
 * This module is the only entry point that takes untrusted user input
 * (a JSON string pulled from a file picker) and writes it to the local
 * Dexie store. Every step from parse → validate → collision-resolve →
 * persist runs here, and each step is a pure function on a bundle object
 * so the UI can call `previewBundle()` to drive a confirmation dialog
 * before committing with `commitReviewBundle()` / `commitWikiBundle()`.
 *
 * Policy decisions encoded here:
 *   • Review collision default → "copy"  (new UUID, rewrite references)
 *   • Wiki collision default  → "skip"  (don't clobber the recipient's notes)
 *   • PDFs are never in the bundle — imported reviews re-fetch from
 *     arxivId/sourceUrl through the app's existing fetch paths.
 *   • Wiki revision history and wikiPageSources are not carried across
 *     bundles (revisions are personal; sources point at review IDs that
 *     almost certainly don't exist on the recipient's side).
 */

import type { Annotation } from "@/lib/annotations";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type { GraphData } from "@/lib/explore";
import * as store from "@/lib/client/store";
import {
  invalidateWikiCache,
  refreshReviews,
} from "@/lib/client-data";
import { getDb } from "@/lib/client/db";
import { extractWikiLinkSlugs } from "@/lib/wiki-link-transform";
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
  counts: {
    messages: number;
    annotations: number;
    deepDives: number;
    graphNodes: number;
  };
  /** Informational note shown in the preview dialog. */
  notes: string[];
}

export interface WikiPreview {
  kind: "wiki";
  bundle: WikiBundle;
  pagesTotal: number;
  /** Slugs already present locally. */
  collidingSlugs: string[];
  /** Slugs that would be freshly added. */
  newSlugs: string[];
}

export type BundlePreview = ReviewPreview | WikiPreview;

export interface ParseResult {
  ok: boolean;
  preview?: BundlePreview;
  error?: string;
}

/* ─── Phase 1: parse + validate + summarize ────────────────────── */

/** Parse a file's text contents and return a preview (or an error string). */
export async function previewBundleFromText(
  text: string,
): Promise<ParseResult> {
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
    return {
      ok: false,
      error: `Bundle failed validation:\n${result.issues.join("\n")}`,
    };
  }

  const bundle = result.bundle;
  if (bundle.type === "review") {
    return { ok: true, preview: await summarizeReview(bundle) };
  }
  return { ok: true, preview: await summarizeWiki(bundle) };
}

async function summarizeReview(bundle: ReviewBundle): Promise<ReviewPreview> {
  const existingById = await store.getReview(bundle.data.review.id);
  let duplicateOfExistingId: string | null = null;
  if (!existingById) {
    // Second-chance lookup by arxivId — a different id but same paper
    // is more common than a straight id collision.
    const arxivId = bundle.data.review.arxivId;
    if (arxivId) {
      const byArxiv = await store.getReviewByArxivId(arxivId);
      if (byArxiv) duplicateOfExistingId = byArxiv.id;
    }
    if (!duplicateOfExistingId && bundle.data.review.sourceUrl) {
      const all = await store.listReviews();
      const hit = all.find(
        (r) => r.sourceUrl === bundle.data.review.sourceUrl,
      );
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
      graphNodes: bundle.data.graph?.nodes.length ?? 0,
    },
    notes,
  };
}

async function summarizeWiki(bundle: WikiBundle): Promise<WikiPreview> {
  const collidingSlugs: string[] = [];
  const newSlugs: string[] = [];
  for (const page of bundle.data.pages) {
    const existing = await store.getWikiPageBySlug(page.slug);
    if (existing) collidingSlugs.push(page.slug);
    else newSlugs.push(page.slug);
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

/** Write a validated review bundle to Dexie. */
export async function commitReviewBundle(
  bundle: ReviewBundle,
  strategy: ReviewCollisionStrategy = "copy",
): Promise<ReviewCommitResult> {
  const db = getDb();

  const existing = await store.getReview(bundle.data.review.id);
  const dupByArxiv = !existing && bundle.data.review.arxivId
    ? await store.getReviewByArxivId(bundle.data.review.arxivId)
    : null;

  // Effective strategy: if nothing collides, "copy" and "overwrite" both
  // collapse to a simple insert under the bundle's original id.
  const hasCollision = !!(existing || dupByArxiv);

  if (hasCollision && strategy === "skip") {
    return {
      finalReviewId: existing?.id ?? dupByArxiv?.id ?? bundle.data.review.id,
      skipped: true,
    };
  }

  // Decide the final reviewId.
  // - copy: always a fresh UUID when there's a collision
  // - overwrite: keep the colliding id, wiping the existing rows
  // - no collision: keep the bundle's own id
  let finalReviewId = bundle.data.review.id;
  if (hasCollision) {
    if (strategy === "copy") {
      finalReviewId = crypto.randomUUID();
    } else {
      finalReviewId = existing?.id ?? dupByArxiv?.id ?? bundle.data.review.id;
    }
  }

  const nowIso = new Date().toISOString();

  // Rewrite references onto the final id.
  const rewrittenReview = {
    ...bundle.data.review,
    id: finalReviewId,
    pdfPath: null, // never trust an incoming pdfPath; strip defensively
    importedAt: nowIso,
    updatedAt: nowIso,
  };

  const rewrittenAnnotations: Annotation[] = bundle.data.annotations.map((a) => ({
    ...a,
    reviewId: finalReviewId,
  }));

  const rewrittenDeepDives: DeepDiveSession[] = bundle.data.deepDives.map(
    (d) => ({
      ...d,
      // Fresh id on copy to avoid colliding with a deepDive the recipient
      // already has; on overwrite we also regenerate since we're wiping
      // the per-review rows below anyway.
      id:
        strategy === "copy" || hasCollision
          ? crypto.randomUUID()
          : d.id,
      reviewId: finalReviewId,
    }),
  );

  const rewrittenGraph: GraphData | null = bundle.data.graph
    ? {
        ...bundle.data.graph,
        anchorReviewId: finalReviewId,
      }
    : null;

  await db.transaction(
    "rw",
    [
      db.reviews,
      db.reviewMessages,
      db.reviewAnnotations,
      db.explorePrerequisites,
      db.exploreGraphs,
      db.deepDives,
    ],
    async () => {
      // Clean out any stale per-review rows before writing (handles
      // both overwrite-in-place and copy-to-new-id uniformly).
      await db.reviewMessages.delete(finalReviewId);
      await db.reviewAnnotations.delete(finalReviewId);
      await db.explorePrerequisites.delete(finalReviewId);
      await db.exploreGraphs.delete(finalReviewId);
      await db.deepDives.where("reviewId").equals(finalReviewId).delete();

      await db.reviews.put(rewrittenReview);
      if (bundle.data.messages.length > 0) {
        await db.reviewMessages.put({
          reviewId: finalReviewId,
          messages: bundle.data.messages,
        });
      }
      if (rewrittenAnnotations.length > 0) {
        await db.reviewAnnotations.put({
          reviewId: finalReviewId,
          annotations: rewrittenAnnotations,
        });
      }
      if (bundle.data.prerequisites) {
        await db.explorePrerequisites.put({
          reviewId: finalReviewId,
          data: bundle.data.prerequisites,
        });
      }
      if (rewrittenGraph) {
        await db.exploreGraphs.put({
          reviewId: finalReviewId,
          graph: rewrittenGraph,
        });
      }
      for (const dd of rewrittenDeepDives) {
        await db.deepDives.put(dd);
      }
    },
  );

  await refreshReviews();
  return { finalReviewId, skipped: false };
}

export interface WikiCommitResult {
  imported: number;
  skipped: number;
  renamed: number;
}

/** Write a validated wiki bundle to Dexie. */
export async function commitWikiBundle(
  bundle: WikiBundle,
  strategy: WikiCollisionStrategy = "skip",
): Promise<WikiCommitResult> {
  const db = getDb();
  let imported = 0;
  let skipped = 0;
  let renamed = 0;

  const now = new Date().toISOString();

  await db.transaction(
    "rw",
    [db.wikiPages, db.wikiRevisions, db.wikiBacklinks],
    async () => {
      for (const page of bundle.data.pages) {
        const existing = await db.wikiPages
          .where("slug")
          .equals(page.slug)
          .first();

        let targetSlug = page.slug;
        let targetId = page.id;

        if (existing) {
          if (strategy === "skip") {
            skipped++;
            continue;
          }
          if (strategy === "overwrite") {
            targetSlug = existing.slug;
            targetId = existing.id;
            // Snapshot the page we're about to clobber so the recipient
            // can still roll back — matches the in-app upsert behavior.
            if (existing.content !== page.content) {
              await db.wikiRevisions.add({
                pageId: existing.id,
                slug: existing.slug,
                title: existing.title,
                content: existing.content,
                pageType: existing.pageType,
                savedAt: now,
              });
            }
          } else {
            // rename: append `-imported`, then `-imported-2`, etc. until free.
            let candidate = `${page.slug}-imported`;
            let attempt = 2;
            while (await db.wikiPages.where("slug").equals(candidate).first()) {
              candidate = `${page.slug}-imported-${attempt++}`;
            }
            targetSlug = candidate;
            targetId = crypto.randomUUID();
            renamed++;
          }
        }

        await db.wikiPages.put({
          id: targetId,
          slug: targetSlug,
          title: page.title,
          content: page.content,
          pageType: page.pageType,
          createdAt: existing?.createdAt ?? page.createdAt ?? now,
          updatedAt: now,
        });

        // Rebuild backlinks from the content we just wrote. The bundle
        // doesn't carry pre-computed backlinks — they're derived state.
        await db.wikiBacklinks.where("sourceId").equals(targetId).delete();
        const targets = extractWikiLinkSlugs(page.content);
        if (targets.length > 0) {
          await db.wikiBacklinks.bulkPut(
            targets.map((t) => ({
              key: `${targetId}::${t}`,
              sourceId: targetId,
              targetSlug: t,
            })),
          );
        }

        imported++;
      }
    },
  );

  invalidateWikiCache();
  return { imported, skipped, renamed };
}

/** Convenience: run through parse → preview → commit using the default strategies. */
export async function importBundleFromText(
  text: string,
): Promise<{
  ok: boolean;
  error?: string;
  bundle?: AnyBundle;
  result?: ReviewCommitResult | WikiCommitResult;
}> {
  const parsed = await previewBundleFromText(text);
  if (!parsed.ok || !parsed.preview) {
    return { ok: false, error: parsed.error };
  }
  const preview = parsed.preview;
  if (preview.kind === "review") {
    const result = await commitReviewBundle(preview.bundle);
    return { ok: true, bundle: preview.bundle, result };
  }
  const result = await commitWikiBundle(preview.bundle);
  return { ok: true, bundle: preview.bundle, result };
}
