import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import { uploadPdf } from "@/server/storage";

export const runtime = "nodejs";

export const POST = authedRoute(async (userId, request: Request) => {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  const path = await uploadPdf(userId, id, buffer);
  await store.recordPdfBlob(userId, id, path, file.name || null);
  return NextResponse.json({ id });
});
