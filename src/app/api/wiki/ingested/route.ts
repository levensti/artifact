import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId, request: Request) => {
  const url = new URL(request.url);
  const reviewId = url.searchParams.get("reviewId");
  if (!reviewId) {
    return NextResponse.json({ error: "reviewId required" }, { status: 400 });
  }
  const ingested = await store.hasWikiSourcesForReview(userId, reviewId);
  return NextResponse.json({ ingested });
});
