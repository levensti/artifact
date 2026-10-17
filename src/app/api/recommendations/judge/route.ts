import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

export const dynamic = "force-dynamic";
// Each pick is one judge call (a few run at once), so a batch of briefs can
// take a while.
export const maxDuration = 120;

const bodySchema = z.object({
  /** Briefs whose unscored picks should be judged. */
  queryIds: z.array(z.string().min(1)).min(1).max(20),
});

/**
 * Judge the unscored picks of the given briefs and reorder them. Used to
 * backfill picks saved before the judge existed. Returns
 * `{ available: false }` when no judge is configured.
 */
export const POST = authedRoute(async (userId, request: Request) => {
  const body = bodySchema.parse(await request.json());
  const result = await store.judgeBriefs(userId, body.queryIds);
  return NextResponse.json(result);
});
