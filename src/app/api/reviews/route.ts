import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import { normalizeArxivId } from "@/lib/arxiv";
import type { PaperReview } from "@/lib/review-types";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId) => {
  const reviews = await store.listReviews(userId);
  return NextResponse.json({ reviews });
});

const createSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("arxiv"),
    arxivId: z.string().min(1),
    title: z.string().default(""),
  }),
  z.object({
    kind: z.literal("local"),
    pdfPath: z.string().min(1),
    title: z.string().default(""),
  }),
  z.object({
    kind: z.literal("web"),
    sourceUrl: z.string().min(1),
    title: z.string().default(""),
  }),
]);

export const POST = authedRoute(async (userId, request: Request) => {
  const body = createSchema.parse(await request.json());

  if (body.kind === "arxiv") {
    const canonical = normalizeArxivId(body.arxivId);
    const existing = await store.getReviewByArxivId(userId, canonical);
    if (existing) return NextResponse.json({ review: existing });
    const now = new Date().toISOString();
    const review: PaperReview = {
      id: crypto.randomUUID(),
      title: body.title || `arXiv:${canonical}`,
      arxivId: canonical,
      createdAt: now,
      updatedAt: now,
      pdfPath: null,
      sourceUrl: null,
    };
    return NextResponse.json({ review: await store.insertReview(userId, review) });
  }

  if (body.kind === "local") {
    const fallback =
      body.pdfPath.split("/").pop()?.replace(/\.pdf$/i, "") || "Local PDF";
    const now = new Date().toISOString();
    const review: PaperReview = {
      id: crypto.randomUUID(),
      title: body.title || fallback,
      arxivId: null,
      createdAt: now,
      updatedAt: now,
      pdfPath: body.pdfPath,
      sourceUrl: null,
    };
    return NextResponse.json({ review: await store.insertReview(userId, review) });
  }

  // web
  const now = new Date().toISOString();
  const review: PaperReview = {
    id: crypto.randomUUID(),
    title: body.title || body.sourceUrl,
    arxivId: null,
    createdAt: now,
    updatedAt: now,
    pdfPath: null,
    sourceUrl: body.sourceUrl,
  };
  return NextResponse.json({ review: await store.insertReview(userId, review) });
});
