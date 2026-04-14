import { NextRequest } from "next/server";
import {
  listWikiPages,
  upsertWikiPage,
  addWikiPageSource,
  getWikiPageBySlug,
} from "@/lib/server/store";
import type { WikiPageType } from "@/lib/wiki";

export const runtime = "nodejs";

export function GET() {
  return Response.json(listWikiPages());
}

export async function POST(req: NextRequest) {
  let body: {
    slug: string;
    title: string;
    content: string;
    pageType: WikiPageType;
    reviewId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { slug, title, content, pageType, reviewId } = body;
  if (!slug || !title || !content || !pageType) {
    return Response.json(
      { error: "slug, title, content, and pageType are required" },
      { status: 400 },
    );
  }

  const id = getWikiPageBySlug(slug)?.id ?? crypto.randomUUID();
  upsertWikiPage({ id, slug, title, content, pageType });

  if (reviewId) {
    addWikiPageSource(id, reviewId);
  }

  const page = getWikiPageBySlug(slug);
  return Response.json(page, { status: 201 });
}
