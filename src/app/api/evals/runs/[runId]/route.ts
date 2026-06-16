import { NextResponse } from "next/server";
import { adminRoute, getRunDetail } from "@/server/evals";

/** GET /api/evals/runs/[runId] — one run's summary + per-question rows. */
export const GET = adminRoute(
  async (_req: Request, ctx: { params: Promise<{ runId: string }> }) => {
    const { runId } = await ctx.params;
    const detail = await getRunDetail(runId);
    if (!detail) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  },
);
