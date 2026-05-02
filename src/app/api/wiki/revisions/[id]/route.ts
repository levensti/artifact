import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const revisionId = Number.parseInt(id, 10);
  if (!Number.isFinite(revisionId)) {
    return NextResponse.json({ error: "Invalid revision id" }, { status: 400 });
  }
  const revision = await store.getWikiRevision(userId, revisionId);
  return NextResponse.json({ revision });
});
