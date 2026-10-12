import { NextResponse } from "next/server";
import { authedRoute, HttpError } from "@/server/api";
import * as store from "@/server/store";
import { findUploadedPdf } from "@/server/storage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Step 2 of a direct upload: confirm the browser's PUT landed in storage,
 * then record the blob so it can be read back via `GET /api/pdf-blobs/[id]`.
 * Idempotent, so a retried request returns the same id.
 */
export const POST = authedRoute(
  async (userId, request: Request, { params }: Ctx) => {
    const { id } = await params;
    if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid upload id");

    let name: string | null = null;
    try {
      const body = (await request.json()) as { name?: unknown };
      if (typeof body.name === "string" && body.name.trim()) {
        name = body.name.trim().slice(0, 255);
      }
    } catch {
      /* name is optional */
    }

    if (await store.getPdfBlob(userId, id)) {
      return NextResponse.json({ id });
    }
    const path = await findUploadedPdf(userId, id);
    if (!path) throw new HttpError(409, "Upload not found in storage");
    await store.recordPdfBlob(userId, id, path, name);
    return NextResponse.json({ id });
  },
);
