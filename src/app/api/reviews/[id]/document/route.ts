import { NextResponse } from "next/server";
import { authedRoute } from "@/server/api";
import * as store from "@/server/store";
import * as docs from "@/server/documents";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The document a review is linked to: index status, the stored text, and
 * the labeled sections. Lets a reopened review skip the browser-side text
 * extraction pass (10–30s on a book) and the re-upload that followed it.
 * 404 when the review has no linked document yet (first open of a new
 * upload) or the document has no stored text (legacy backfill row); the
 * client then extracts and registers as usual.
 */
export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const review = await store.getReview(userId, id);
  if (!review?.documentId) {
    return NextResponse.json({ error: "No document" }, { status: 404 });
  }
  const doc = await docs.getDocumentById(review.documentId);
  if (!doc?.text) {
    return NextResponse.json({ error: "No document text" }, { status: 404 });
  }
  const sections = await docs.listCitableSections(doc.hash);
  return NextResponse.json({ status: docs.toStatus(doc), text: doc.text, sections });
});
