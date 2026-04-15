import { NextRequest } from "next/server";
import { hasWikiSourcesForReview } from "@/lib/server/store";

export const runtime = "nodejs";

export function GET(req: NextRequest) {
  const reviewId = req.nextUrl.searchParams.get("reviewId");
  if (!reviewId) {
    return Response.json(
      { error: "reviewId query parameter is required" },
      { status: 400 },
    );
  }
  return Response.json({ ingested: hasWikiSourcesForReview(reviewId) });
}
