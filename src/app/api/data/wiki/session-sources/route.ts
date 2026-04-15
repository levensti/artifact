import { NextRequest } from "next/server";
import {
  getRecentActivity,
  getSessionSources,
  listSessionPagesInRange,
} from "@/lib/server/session-sources";

export const runtime = "nodejs";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("mode") ?? "day";

  if (mode === "week-sessions") {
    const start = params.get("start");
    const end = params.get("end");
    if (!start || !end || !DATE_KEY.test(start) || !DATE_KEY.test(end)) {
      return Response.json(
        { error: "start and end (YYYY-MM-DD) required" },
        { status: 400 },
      );
    }
    return Response.json({ sessions: listSessionPagesInRange(start, end) });
  }

  if (mode === "activity") {
    const since = params.get("since");
    if (!since || Number.isNaN(Date.parse(since))) {
      return Response.json(
        { error: "since (ISO timestamp) required" },
        { status: 400 },
      );
    }
    return Response.json(getRecentActivity(since));
  }

  const date = params.get("date");
  if (!date || !DATE_KEY.test(date)) {
    return Response.json(
      { error: "date query parameter (YYYY-MM-DD) is required" },
      { status: 400 },
    );
  }
  return Response.json(getSessionSources(date));
}
