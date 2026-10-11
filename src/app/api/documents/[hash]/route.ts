import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as docs from "@/server/documents";

type Ctx = { params: Promise<{ hash: string }> };

/** Index status for a document; the client polls this while indexing runs. */
export const GET = authedRoute(async (_userId, _req: Request, { params }: Ctx) => {
  const { hash } = await params;
  const doc = await docs.getDocumentByHash(hash);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(docs.toStatus(doc));
});
