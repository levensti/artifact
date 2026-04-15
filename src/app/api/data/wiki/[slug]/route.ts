import {
  getWikiPageBySlug,
  upsertWikiPage,
  deleteWikiPage,
} from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const page = getWikiPageBySlug(decodeURIComponent(slug));
  if (!page) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(page);
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const decoded = decodeURIComponent(slug);
  const existing = getWikiPageBySlug(decoded);
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let body: { title?: string; content?: string; pageType?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    body.pageType !== undefined &&
    body.pageType !== "session" &&
    body.pageType !== "digest"
  ) {
    return Response.json(
      { error: `Invalid pageType: ${body.pageType}` },
      { status: 400 },
    );
  }

  upsertWikiPage({
    id: existing.id,
    slug: decoded,
    title: body.title ?? existing.title,
    content: body.content ?? existing.content,
    pageType: (body.pageType as typeof existing.pageType) ?? existing.pageType,
  });

  return Response.json(getWikiPageBySlug(decoded));
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const existing = getWikiPageBySlug(decodeURIComponent(slug));
  if (!existing) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  deleteWikiPage(existing.id);
  return Response.json({ ok: true });
}
