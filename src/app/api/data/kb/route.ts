import {
  listWikiPages,
  upsertWikiPage,
} from "@/lib/server/store";
import type { WikiPage } from "@/lib/kb-types";

export const runtime = "nodejs";

export function GET() {
  return Response.json(listWikiPages());
}

export async function POST(req: Request) {
  let body: Partial<WikiPage>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!slug || !title) {
    return Response.json(
      { error: "slug and title are required" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const page: WikiPage = {
    id: body.id || crypto.randomUUID(),
    slug,
    title,
    content: typeof body.content === "string" ? body.content : "",
    pageType: body.pageType ?? "concept",
    tags: Array.isArray(body.tags) ? body.tags : [],
    createdAt: body.createdAt ?? now,
    updatedAt: now,
  };
  upsertWikiPage(page);
  return Response.json(page);
}
