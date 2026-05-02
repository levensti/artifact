import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import type { Annotation } from "@/lib/annotations";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const annotations = await store.getAnnotations(userId, id);
  return NextResponse.json({ annotations });
});

const putSchema = z.object({ annotations: z.array(z.unknown()) });

export const PUT = authedRoute(async (userId, request: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = putSchema.parse(await request.json());
  await store.setAnnotations(userId, id, body.annotations as Annotation[]);
  return NextResponse.json({ ok: true });
});
