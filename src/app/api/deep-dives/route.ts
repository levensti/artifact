import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId) => {
  const deepDives = await store.listDeepDives(userId);
  return NextResponse.json({ deepDives });
});

const postSchema = z.object({
  reviewId: z.string().min(1),
  paperTitle: z.string(),
  arxivId: z.string(),
  topic: z.string(),
  explanation: z.string(),
});

export const POST = authedRoute(async (userId, request: Request) => {
  const body = postSchema.parse(await request.json());
  const session = await store.insertDeepDive(userId, {
    ...body,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ deepDive: session });
});
