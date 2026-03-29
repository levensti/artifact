import {
  clearExploreData,
  getGraphData,
  getPrerequisites,
  setGraphData,
  setPrerequisites,
} from "@/lib/server/store";
import type { GraphData, PrerequisitesData } from "@/lib/explore";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ reviewId: string }> },
) {
  const { reviewId } = await ctx.params;
  return Response.json({
    prerequisites: getPrerequisites(reviewId),
    graph: getGraphData(reviewId),
  });
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ reviewId: string }> },
) {
  const { reviewId } = await ctx.params;
  let body: {
    prerequisites?: PrerequisitesData | null;
    graph?: GraphData | null;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.prerequisites !== undefined && body.prerequisites !== null) {
    setPrerequisites(reviewId, body.prerequisites);
  }
  if (body.graph !== undefined && body.graph !== null) {
    setGraphData(reviewId, body.graph);
  }
  return Response.json({
    prerequisites: getPrerequisites(reviewId),
    graph: getGraphData(reviewId),
  });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ reviewId: string }> },
) {
  const { reviewId } = await ctx.params;
  clearExploreData(reviewId);
  return Response.json({ ok: true });
}
