import {
  clearGlobalKnowledgeGraph,
  getGlobalGraphData,
  setGlobalGraphData,
} from "@/lib/server/store";
import type { GlobalGraphData } from "@/lib/explore";

export const runtime = "nodejs";

export function GET() {
  return Response.json(getGlobalGraphData());
}

export async function PUT(req: Request) {
  let body: GlobalGraphData;
  try {
    body = (await req.json()) as GlobalGraphData;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  setGlobalGraphData(body);
  return Response.json({ ok: true });
}

export function DELETE() {
  clearGlobalKnowledgeGraph();
  return Response.json({ ok: true });
}
