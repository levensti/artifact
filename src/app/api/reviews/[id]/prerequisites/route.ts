import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import type { PrerequisitesData } from "@/lib/explore";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const prerequisites = await store.getPrerequisites(userId, id);
  return NextResponse.json({ prerequisites });
});

export const PUT = authedRoute(async (userId, request: Request, { params }: Ctx) => {
  const { id } = await params;
  const { prerequisites } = (await request.json()) as {
    prerequisites: PrerequisitesData;
  };
  await store.setPrerequisites(userId, id, prerequisites);
  return NextResponse.json({ ok: true });
});

export const DELETE = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  await store.clearPrerequisites(userId, id);
  return NextResponse.json({ ok: true });
});
