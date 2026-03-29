import { getAnnotations, getReview, setAnnotations } from "@/lib/server/store";
import type { Annotation } from "@/lib/annotations";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!getReview(id)) {
    return Response.json({ error: "Review not found" }, { status: 404 });
  }
  return Response.json(getAnnotations(id));
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!getReview(id)) {
    return Response.json({ error: "Review not found" }, { status: 404 });
  }
  let body: { annotations?: Annotation[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.annotations)) {
    return Response.json(
      { error: "annotations array required" },
      { status: 400 },
    );
  }
  setAnnotations(id, body.annotations);
  return Response.json({ ok: true });
}
