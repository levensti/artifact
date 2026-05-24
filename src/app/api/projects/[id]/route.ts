import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(100),
});

export const PATCH = authedRoute(async (userId, request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = patchSchema.parse(await request.json());
  const project = await store.updateProject(userId, id, body);
  return NextResponse.json({ project });
});

export const DELETE = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  await store.deleteProject(userId, id);
  return NextResponse.json({ ok: true });
});
