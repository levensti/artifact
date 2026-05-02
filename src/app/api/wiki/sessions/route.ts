import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = authedRoute(async (userId, request: Request) => {
  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "start and end required" }, { status: 400 });
  }
  const pages = await store.listSessionPagesInRange(userId, start, end);
  return NextResponse.json({ pages });
});
