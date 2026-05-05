import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const revision = await store.getWikiRevision(userId, id);
  return NextResponse.json({ revision });
});
