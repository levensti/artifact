import { listKbLog } from "@/lib/server/store";

export const runtime = "nodejs";

export function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  return Response.json(listKbLog(limit));
}
