import {
  getReviewByArxivId,
  insertReview,
  listReviews,
} from "@/lib/server/store";
import { normalizeArxivId } from "@/lib/reviews";
import type { PaperReview } from "@/lib/review-types";

export const runtime = "nodejs";

export function GET() {
  return Response.json(listReviews());
}

export async function POST(req: Request) {
  let body: { arxivId?: string; title?: string; pdfPath?: string; sourceUrl?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title : "";
  const pdfPath = typeof body.pdfPath === "string" ? body.pdfPath.trim() : null;
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : null;

  // Web page review
  if (sourceUrl) {
    const now = new Date().toISOString();
    const review: PaperReview = {
      id: crypto.randomUUID(),
      title: title || sourceUrl,
      arxivId: null,
      createdAt: now,
      updatedAt: now,
      pdfPath: null,
      sourceUrl,
    };
    insertReview(review);
    return Response.json(review);
  }

  // Local PDF review
  if (pdfPath) {
    const now = new Date().toISOString();
    const review: PaperReview = {
      id: crypto.randomUUID(),
      title: title || pdfPath.split("/").pop()?.replace(/\.pdf$/i, "") || "Local PDF",
      arxivId: null,
      createdAt: now,
      updatedAt: now,
      pdfPath,
      sourceUrl: null,
    };
    insertReview(review);
    return Response.json(review);
  }

  // arXiv review
  const arxivRaw = body.arxivId;
  if (!arxivRaw || typeof arxivRaw !== "string") {
    return Response.json({ error: "arxivId, pdfPath, or sourceUrl is required" }, { status: 400 });
  }
  const canonical = normalizeArxivId(arxivRaw);
  const existing = getReviewByArxivId(canonical);
  if (existing) {
    return Response.json(existing);
  }
  const now = new Date().toISOString();
  const review: PaperReview = {
    id: crypto.randomUUID(),
    title: title || `arXiv:${canonical}`,
    arxivId: canonical,
    createdAt: now,
    updatedAt: now,
    pdfPath: null,
    sourceUrl: null,
  };
  insertReview(review);
  return Response.json(review);
}
