import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { authedRoute, HttpError } from "@/server/api";
import { prisma } from "@/server/db";
import * as store from "@/server/store";
import type { Annotation } from "@/lib/annotations";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type { PaperReview } from "@/lib/review-types";
import { validateBundle } from "@/lib/client/sharing/bundle-format";

const asJson = <T>(value: T): Prisma.InputJsonValue =>
  value as unknown as Prisma.InputJsonValue;

const schema = z.object({
  bundle: z.unknown(),
  strategy: z.enum(["copy", "skip", "overwrite"]).default("copy"),
});

export const POST = authedRoute(async (userId, request: Request) => {
  const { bundle: raw, strategy } = schema.parse(await request.json());
  const result = validateBundle(raw);
  if (!result.ok || !result.bundle || result.bundle.type !== "review") {
    throw new HttpError(400, "Invalid review bundle");
  }
  const bundle = result.bundle;

  const existing = await store.getReview(userId, bundle.data.review.id);
  const dupByArxiv =
    !existing && bundle.data.review.arxivId
      ? await store.getReviewByArxivId(userId, bundle.data.review.arxivId)
      : null;
  const hasCollision = !!(existing || dupByArxiv);

  if (hasCollision && strategy === "skip") {
    return NextResponse.json({
      finalReviewId: existing?.id ?? dupByArxiv!.id,
      skipped: true,
    });
  }

  let finalReviewId = bundle.data.review.id;
  if (hasCollision) {
    finalReviewId =
      strategy === "copy"
        ? crypto.randomUUID()
        : (existing?.id ?? dupByArxiv!.id);
  }

  const nowIso = new Date().toISOString();
  const review: PaperReview = {
    ...bundle.data.review,
    id: finalReviewId,
    pdfPath: null,
    importedAt: nowIso,
    updatedAt: nowIso,
  };
  const annotations: Annotation[] = bundle.data.annotations.map((a) => ({
    ...a,
    reviewId: finalReviewId,
  }));
  const deepDives: DeepDiveSession[] = bundle.data.deepDives.map((d) => ({
    ...d,
    id: strategy === "copy" || hasCollision ? crypto.randomUUID() : d.id,
    reviewId: finalReviewId,
  }));

  await prisma.$transaction(async (tx) => {
    if (existing && strategy === "overwrite") {
      await tx.review.delete({ where: { id: existing.id } });
    } else if (dupByArxiv && strategy === "overwrite") {
      await tx.review.delete({ where: { id: dupByArxiv.id } });
    }
    await tx.review.create({
      data: {
        id: finalReviewId,
        userId,
        title: review.title,
        arxivId: review.arxivId,
        pdfPath: null,
        sourceUrl: review.sourceUrl,
        createdAt: new Date(review.createdAt),
        updatedAt: new Date(review.updatedAt),
        importedAt: new Date(nowIso),
      },
    });
    if (bundle.data.messages.length > 0) {
      await tx.reviewMessages.create({
        data: { reviewId: finalReviewId, messages: asJson(bundle.data.messages) },
      });
    }
    if (annotations.length > 0) {
      await tx.reviewAnnotations.create({
        data: { reviewId: finalReviewId, annotations: asJson(annotations) },
      });
    }
    if (bundle.data.prerequisites) {
      await tx.prerequisites.create({
        data: { reviewId: finalReviewId, data: asJson(bundle.data.prerequisites) },
      });
    }
    for (const dd of deepDives) {
      await tx.deepDive.create({
        data: {
          id: dd.id,
          userId,
          reviewId: finalReviewId,
          paperTitle: dd.paperTitle,
          arxivId: dd.arxivId,
          topic: dd.topic,
          explanation: dd.explanation,
          createdAt: new Date(dd.createdAt),
        },
      });
    }
  });

  return NextResponse.json({ finalReviewId, skipped: false });
});
