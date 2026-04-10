import { searchAll } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return Response.json([]);
  }
  const results = searchAll(q, 20);
  return Response.json(results);
}
