import { NextRequest, NextResponse } from "next/server";
import { adminRoute, getEvalOverview } from "@/server/evals";

/** GET /api/evals?benchmark=<id> — benchmarks + the selected benchmark's runs. */
export const GET = adminRoute(async (req: NextRequest) => {
  const benchmarkId = req.nextUrl.searchParams.get("benchmark") ?? undefined;
  const overview = await getEvalOverview(benchmarkId);
  return NextResponse.json(overview);
});
