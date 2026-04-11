import { getKbMessages, setKbMessages } from "@/lib/server/store";

export const runtime = "nodejs";

export function GET() {
  return Response.json(getKbMessages());
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return Response.json({ error: "Expected array" }, { status: 400 });
  }
  setKbMessages(body);
  return Response.json({ ok: true });
}
