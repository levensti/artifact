import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as docs from "@/server/documents";
import type { PageMap } from "@/lib/review-types";

type Ctx = { params: Promise<{ hash: string }> };

/** Citation-token → page map cache, shared by every reader of the document. */
export const GET = authedRoute(async (_userId, _req: Request, { params }: Ctx) => {
  const { hash } = await params;
  return NextResponse.json({ map: await docs.getPageMap(hash) });
});

export const PUT = authedRoute(async (_userId, request: Request, { params }: Ctx) => {
  const { hash } = await params;
  const { map } = (await request.json()) as { map: PageMap };
  if (!map || typeof map !== "object") {
    return NextResponse.json({ error: "map is required" }, { status: 400 });
  }
  await docs.setPageMap(hash, map);
  return NextResponse.json({ ok: true });
});
