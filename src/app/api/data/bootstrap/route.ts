import { getBootstrap } from "@/lib/server/store";

export const runtime = "nodejs";

export function GET() {
  return Response.json(getBootstrap());
}
