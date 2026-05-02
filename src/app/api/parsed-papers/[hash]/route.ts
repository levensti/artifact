import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import type { ParsedPaper } from "@/lib/review-types";

type Ctx = { params: Promise<{ hash: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { hash } = await params;
  const parsed = await store.getCachedParsedPaper(userId, hash);
  return NextResponse.json({ parsed });
});

export const PUT = authedRoute(async (userId, request: Request, { params }: Ctx) => {
  const { hash } = await params;
  const { parsed } = (await request.json()) as { parsed: ParsedPaper };
  await store.cacheParsedPaper(userId, hash, parsed);
  return NextResponse.json({ ok: true });
});
