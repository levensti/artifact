import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import { createPdfUploadUrl } from "@/server/storage";

export const runtime = "nodejs";

/**
 * Step 1 of a direct upload: reserve a blob id and hand back a signed URL
 * the browser uploads the PDF bytes to. Step 2 is
 * `POST /api/pdf-blobs/[id]/complete`, which records the blob once the
 * object is in storage.
 */
export const POST = authedRoute(async (userId) => {
  const id = crypto.randomUUID();
  const { signedUrl } = await createPdfUploadUrl(userId, id);
  return NextResponse.json({ id, uploadUrl: signedUrl });
});
