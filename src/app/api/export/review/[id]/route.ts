import { NextResponse } from "next/server";
import { authedRoute, HttpError } from "@/server/api";
import * as store from "@/server/store";
import {
  CURRENT_SCHEMA_VERSION,
  type ReviewBundle,
} from "@/lib/client/sharing/bundle-format";

type Ctx = { params: Promise<{ id: string }> };

export const GET = authedRoute(async (userId, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const review = await store.getReview(userId, id);
  if (!review) throw new HttpError(404, "Review not found");
  if (!review.arxivId && !review.sourceUrl) {
    throw new HttpError(400, "Locally-uploaded PDFs cannot be shared");
  }

  const [messages, annotations, prerequisites, allDeepDives] = await Promise.all([
    store.getMessages(userId, id),
    store.getAnnotations(userId, id),
    store.getPrerequisites(userId, id),
    store.listDeepDives(userId),
  ]);
  const deepDives = allDeepDives.filter((d) => d.reviewId === id);

  // Strip importedAt + pdfPath before sharing.
  const { importedAt: _importedAt, ...exported } = review;
  void _importedAt;
  const scrubbedReview = { ...exported, pdfPath: null };

  const bundle: ReviewBundle = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    type: "review",
    exportedAt: new Date().toISOString(),
    data: {
      review: scrubbedReview,
      messages,
      annotations,
      deepDives,
      prerequisites,
    },
  };
  return NextResponse.json({ bundle });
});
