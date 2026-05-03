/**
 * Bulk-add papers to a project from a list of arXiv URLs or IDs.
 *
 * Input shape: { items: string[] } where each item is either an arXiv URL
 * (https://arxiv.org/abs/...) or a raw ID (2402.00277). Items that don't
 * parse are reported back so the user can fix them. Resolution of titles
 * is best-effort — if arXiv's metadata API fails for a given ID, we fall
 * back to "arXiv:ID" so the review still lands. The user can rename
 * later from the workspace page.
 *
 * Idempotent on arxivId: if a review for that ID already exists, we reuse
 * it and just attach the membership.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, HttpError } from "@/server/api";
import * as projectsStore from "@/server/projects";
import * as store from "@/server/store";
import { extractArxivId } from "@/lib/utils";
import { normalizeArxivId } from "@/lib/arxiv";
import type { PaperReview } from "@/lib/review-types";

type Ctx = { params: Promise<{ id: string }> };

const ARXIV_ID_RE = /^\d{4}\.\d{4,5}(?:v\d+)?$/i;

const postSchema = z.object({
  items: z.array(z.string().min(1)).min(1).max(100),
});

interface BulkAddResult {
  added: number;
  reused: number;
  failed: { input: string; reason: string }[];
  reviewIds: string[];
}

export const POST = authedRoute(
  async (userId, request: Request, { params }: Ctx) => {
    const { id: projectId } = await params;
    const body = postSchema.parse(await request.json());

    // Pre-flight: project exists and is owned by this user.
    const project = await projectsStore.getProject(userId, projectId);
    if (!project) throw new HttpError(404, "Project not found");

    // Resolve each input to a canonical arXiv ID, dedup'd.
    const resolved: { input: string; arxivId: string }[] = [];
    const failed: { input: string; reason: string }[] = [];
    const seen = new Set<string>();

    for (const raw of body.items) {
      const cleaned = raw.trim();
      if (!cleaned) continue;
      const fromUrl = extractArxivId(cleaned);
      const candidate =
        fromUrl ?? (ARXIV_ID_RE.test(cleaned) ? cleaned : null);
      if (!candidate) {
        failed.push({ input: raw, reason: "Not a recognized arXiv URL or ID" });
        continue;
      }
      const canonical = normalizeArxivId(candidate);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      resolved.push({ input: raw, arxivId: canonical });
    }

    // Resolve to existing-or-new reviews in parallel. Title resolution
    // is best-effort — failure falls back to "arXiv:ID".
    const reviewResults = await Promise.all(
      resolved.map(async ({ input, arxivId }) => {
        try {
          const existing = await store.getReviewByArxivId(userId, arxivId);
          if (existing) {
            return { input, arxivId, review: existing, reused: true };
          }
          const title = await fetchArxivTitle(arxivId);
          const now = new Date().toISOString();
          const review: PaperReview = {
            id: crypto.randomUUID(),
            title: title || `arXiv:${arxivId}`,
            arxivId,
            createdAt: now,
            updatedAt: now,
            pdfPath: null,
            sourceUrl: null,
          };
          const created = await store.insertReview(userId, review);
          return { input, arxivId, review: created, reused: false };
        } catch (err) {
          failed.push({
            input,
            reason: err instanceof Error ? err.message : "Failed to add",
          });
          return null;
        }
      }),
    );

    const ok = reviewResults.filter(
      (r): r is NonNullable<typeof r> => r !== null,
    );
    const reviewIds = ok.map((r) => r.review.id);

    // One-shot attach. `addReviewsToProject` skips duplicates so re-running
    // the same payload after a partial failure is safe.
    const attached = await projectsStore.addReviewsToProject(
      userId,
      projectId,
      reviewIds,
    );

    const reusedCount = ok.filter((r) => r.reused).length;
    const result: BulkAddResult = {
      added: attached,
      reused: reusedCount,
      failed,
      reviewIds,
    };
    return NextResponse.json(result);
  },
);

/// Hit arXiv's Atom-format metadata endpoint and return the cleaned
/// title. Returns null on any failure (network, parse, missing entry)
/// so the caller can fall back. Cached for a day at the platform layer.
async function fetchArxivTitle(arxivId: string): Promise<string | null> {
  try {
    const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Artifact/1.0 (academic research tool)" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const entryStart = xml.indexOf("<entry>");
    if (entryStart === -1) return null;
    const entry = xml.slice(entryStart);
    const m = entry.match(/<title>([\s\S]*?)<\/title>/);
    if (!m) return null;
    const cleaned = m[1].replace(/\s+/g, " ").trim();
    return cleaned || null;
  } catch {
    return null;
  }
}
