import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import type { PageMap } from "@/lib/review-types";

type Ctx = { params: Promise<{ hash: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { hash } = await params;
  const map = await store.getCachedPageMap(userId, hash);
  return NextResponse.json({ map });
});

export const PUT = authedRoute(async (userId, request: Request, { params }: Ctx) => {
  const { hash } = await params;
  const { map } = (await request.json()) as { map: PageMap };
  await store.cachePageMap(userId, hash, map);
  return NextResponse.json({ ok: true });
});
