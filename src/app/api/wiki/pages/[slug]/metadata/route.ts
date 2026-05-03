import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { slug } = await params;
  const [backlinks, sources, revisions] = await Promise.all([
    store.getWikiBacklinks(userId, slug),
    store.getWikiPageSources(userId, slug),
    store.listWikiRevisions(userId, slug),
  ]);
  return NextResponse.json({ backlinks, sources, revisions });
});
