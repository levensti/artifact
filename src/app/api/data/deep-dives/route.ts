import { insertDeepDive, listDeepDives } from "@/lib/server/store";
import type { DeepDiveSession } from "@/lib/deep-dives";

export const runtime = "nodejs";

export function GET() {
  return Response.json(listDeepDives());
}

export async function POST(req: Request) {
  let body: Omit<DeepDiveSession, "id" | "createdAt">;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    !body.reviewId ||
    !body.paperTitle ||
    !body.arxivId ||
    !body.topic ||
    !body.explanation
  ) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }
  const session: DeepDiveSession = {
    ...body,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  insertDeepDive(session);
  return Response.json(session);
}
