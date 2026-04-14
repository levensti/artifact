import { getWikiRevision } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const numeric = Number.parseInt(id, 10);
  if (!Number.isFinite(numeric)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const rev = getWikiRevision(numeric);
  if (!rev) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(rev);
}
