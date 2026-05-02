import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import { deletePdf, downloadPdf } from "@/server/storage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const meta = await store.getPdfBlob(userId, id);
  if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const blob = await downloadPdf(meta.storagePath);
  return new NextResponse(blob.stream(), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, max-age=3600",
    },
  });
});

export const DELETE = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const path = await store.deletePdfBlobRecord(userId, id);
  if (path) {
    await deletePdf(path).catch((err) =>
      console.warn("pdf storage delete failed (ignored):", err),
    );
  }
  return NextResponse.json({ ok: true });
});
