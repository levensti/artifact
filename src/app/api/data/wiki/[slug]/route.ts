import { NextRequest } from "next/server";
import {
  getWikiArticle,
  upsertWikiArticle,
  deleteWikiArticle,
} from "@/lib/server/store";
import type { WikiArticle } from "@/lib/wiki";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const article = getWikiArticle(slug);
  if (!article) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(article);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { slug } = await params;
  let body: WikiArticle;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.title || !body.contentMd) {
    return Response.json(
      { error: "title and contentMd are required" },
      { status: 400 },
    );
  }
  const article: WikiArticle = {
    ...body,
    slug,
    updatedAt: new Date().toISOString(),
  };
  upsertWikiArticle(article);
  return Response.json(article);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const deleted = deleteWikiArticle(slug);
  if (!deleted) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
