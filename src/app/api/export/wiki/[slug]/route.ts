import { NextResponse } from "next/server";
import { authedRoute, HttpError } from "@/server/api";
import * as store from "@/server/store";
import { extractWikiLinkSlugs } from "@/lib/wiki-link-transform";
import type { WikiPage } from "@/lib/wiki";
import {
  CURRENT_SCHEMA_VERSION,
  type WikiBundle,
} from "@/lib/client/sharing/bundle-format";

const MAX_DEPTH = 3;

type Ctx = { params: Promise<{ slug: string }> };

export const GET = authedRoute(async (userId, request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const url = new URL(request.url);
  const requested = Number.parseInt(url.searchParams.get("depth") ?? "1", 10);
  const depth = Math.max(0, Math.min(MAX_DEPTH, Number.isFinite(requested) ? requested : 1));

  const root = await store.getWikiPageBySlug(userId, slug);
  if (!root) throw new HttpError(404, "Wiki page not found");

  const seen = new Map<string, WikiPage>();
  seen.set(root.slug, root);
  const order = [root.slug];
  let frontier: WikiPage[] = [root];

  for (let d = 0; d < depth; d++) {
    const next: WikiPage[] = [];
    for (const page of frontier) {
      for (const target of extractWikiLinkSlugs(page.content)) {
        if (seen.has(target)) continue;
        const linked = await store.getWikiPageBySlug(userId, target);
        if (!linked) continue;
        seen.set(linked.slug, linked);
        order.push(linked.slug);
        next.push(linked);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  const pages = order.map((s) => seen.get(s)!).filter(Boolean);
  const bundle: WikiBundle = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    type: "wiki",
    exportedAt: new Date().toISOString(),
    data: { pages },
  };
  return NextResponse.json({ bundle });
});
