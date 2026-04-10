import { deleteReview, getReview, setSummary } from "@/lib/server/store";
import type { PaperSummary } from "@/lib/review-types";

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

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const review = getReview(id);
  if (!review) {
    return Response.json({ error: "Review not found" }, { status: 404 });
  }
  const body = (await req.json()) as { summary?: PaperSummary | null };
  if ("summary" in body) {
    setSummary(id, body.summary ?? null);
  }
  const updated = getReview(id);
  return Response.json(updated);
}
