import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId) => {
  const [queries, recommendations] = await Promise.all([
    store.listDiscoverQueries(userId),
    store.listRecommendations(userId),
  ]);
  return NextResponse.json({ queries, recommendations });
});

const createSchema = z.object({
  query: z.string().min(1).max(2000),
  /** Start the research inside a project. */
  projectId: z.string().min(1).nullable().optional(),
});

export const POST = authedRoute(async (userId, request: Request) => {
  const body = createSchema.parse(await request.json());
  const query = await store.createDiscoverQuery(
    userId,
    body.query.trim(),
    body.projectId ?? null,
  );
  return NextResponse.json({ query });
});
