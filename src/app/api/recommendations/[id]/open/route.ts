import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Open a recommendation: get-or-create the matching Review and set
 * `Review.fromRecommendationId` if the review is freshly created. Idempotent
 * on re-call — re-surfacing a paper already in the library returns the
 * existing review without overwriting the original origin.
 */
export const POST = authedRoute(
  async (userId, _req: Request, { params }: Ctx) => {
    const { id } = await params;
    const result = await store.openRecommendation(userId, id);
    return NextResponse.json(result);
  },
);
