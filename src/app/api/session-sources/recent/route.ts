import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import { getRecentActivity } from "@/server/session-sources";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId, request: Request) => {
  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  if (!since) {
    return NextResponse.json({ error: "since required" }, { status: 400 });
  }
  const activity = await getRecentActivity(userId, since);
  return NextResponse.json({ activity });
});
