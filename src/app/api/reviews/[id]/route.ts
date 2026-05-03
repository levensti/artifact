import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import { deletePdf } from "@/server/storage";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const review = await store.getReview(userId, id);
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ review });
});

export const DELETE = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const result = await store.deleteReview(userId, id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result.pdfPath) {
    const blob = await store.getPdfBlob(userId, result.pdfPath);
    if (blob) {
      await store.deletePdfBlobRecord(userId, result.pdfPath);
      await deletePdf(blob.storagePath).catch((err) =>
        console.warn("pdf storage delete failed (ignored):", err),
      );
    }
  }
  return NextResponse.json({ ok: true });
});
