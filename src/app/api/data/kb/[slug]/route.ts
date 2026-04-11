import {
  getWikiPageBySlug,
  upsertWikiPage,
  deleteWikiPage,
  getWikiPageSources,
} from "@/lib/server/store";
import type { WikiPage } from "@/lib/kb-types";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  const page = getWikiPageBySlug(slug);
  if (!page) {
    return Response.json({ error: "Page not found" }, { status: 404 });
  }
  const sources = getWikiPageSources(page.id);
  return Response.json({ ...page, sources });
}

export async function PUT(req: Request, { params }: Params) {
  const { slug } = await params;
  const existing = getWikiPageBySlug(slug);
  if (!existing) {
    return Response.json({ error: "Page not found" }, { status: 404 });
  }

  let body: Partial<WikiPage>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updated: WikiPage = {
    ...existing,
    title: typeof body.title === "string" ? body.title.trim() : existing.title,
    content: typeof body.content === "string" ? body.content : existing.content,
    pageType: body.pageType ?? existing.pageType,
    tags: Array.isArray(body.tags) ? body.tags : existing.tags,
    slug: typeof body.slug === "string" ? body.slug.trim() : existing.slug,
    updatedAt: new Date().toISOString(),
  };
  upsertWikiPage(updated);
  return Response.json(updated);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { slug } = await params;
  const existing = getWikiPageBySlug(slug);
  if (!existing) {
    return Response.json({ error: "Page not found" }, { status: 404 });
  }
  deleteWikiPage(existing.id);
  return Response.json({ ok: true });
}
