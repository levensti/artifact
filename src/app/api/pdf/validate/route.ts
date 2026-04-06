import fs from "fs";
import path from "path";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const filePath = typeof body.path === "string" ? body.path.trim() : "";
  if (!filePath) {
    return Response.json({ valid: false, error: "No path provided" });
  }

  const resolved = path.resolve(filePath);
  if (!resolved.toLowerCase().endsWith(".pdf")) {
    return Response.json({ valid: false, error: "File must be a .pdf" });
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return Response.json({ valid: false, error: "Path is not a file" });
    }
    return Response.json({ valid: true, resolvedPath: resolved });
  } catch {
    return Response.json({ valid: false, error: "File not found" });
  }
}
