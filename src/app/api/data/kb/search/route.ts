import { searchWikiPages } from "@/lib/server/store";

export const runtime = "nodejs";

export function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  if (q.trim().length < 2) {
    return Response.json([]);
  }
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  return Response.json(searchWikiPages(q.trim(), limit));
}
