import { deleteReview, getReview } from "@/lib/server/store";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!getReview(id)) {
    return Response.json({ error: "Review not found" }, { status: 404 });
  }
  const removed = deleteReview(id);
  if (!removed) {
    return Response.json({ error: "Delete failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
