import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { slug } = await params;
  const page = await store.getWikiPageBySlug(userId, slug);
  return NextResponse.json({ page });
});

const putSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  content: z.string(),
  pageType: z.enum(["session", "digest"]),
  reviewId: z.string().optional(),
});

export const PUT = authedRoute(async (userId, request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const body = putSchema.parse(await request.json());

  const existing = await store.getWikiPageBySlug(userId, slug);
  const id = existing?.id ?? body.id ?? crypto.randomUUID();
  const page = await store.upsertWikiPage(userId, {
    id,
    slug,
    title: body.title,
    content: body.content,
    pageType: body.pageType,
  });
  if (body.reviewId) {
    await store.addWikiPageSource(userId, page.id, body.reviewId);
  }
  return NextResponse.json({ page });
});

export const DELETE = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { slug } = await params;
  await store.deleteWikiPageBySlug(userId, slug);
  return NextResponse.json({ ok: true });
});
