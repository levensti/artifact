import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "Only .pdf files are supported" }, { status: 400 });
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const id = crypto.randomUUID();
  const filename = `${id}.pdf`;
  const savedPath = path.join(UPLOADS_DIR, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(savedPath, buffer);

  return Response.json({ pdfPath: savedPath, originalName: file.name });
}
