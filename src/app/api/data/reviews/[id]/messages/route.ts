import { getMessages, getReview, setMessages } from "@/lib/server/store";
import type { ChatMessage } from "@/lib/review-types";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!getReview(id)) {
    return Response.json({ error: "Review not found" }, { status: 404 });
  }
  return Response.json(getMessages(id));
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!getReview(id)) {
    return Response.json({ error: "Review not found" }, { status: 404 });
  }
  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) {
    return Response.json({ error: "messages array required" }, { status: 400 });
  }
  setMessages(id, body.messages);
  return Response.json({ ok: true });
}
