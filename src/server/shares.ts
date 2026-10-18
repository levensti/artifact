import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./api";
import { sendSlackEvent, SlackEventType } from "./notifications";

/* ── Types ────────────────────────────────────────────────────── */

/// Reviews are the only shareable thing; `kind` stays on the wire and in
/// the table so links keep their shape.
export type ShareKind = "review";

export interface ShareSummary {
  token: string;
  kind: ShareKind;
  createdAt: string;
  revokedAt: string | null;
  lastAccessAt: string | null;
  accessCount: number;
  importCount: number;
  // Lightweight target identification — full payload comes from the
  // separate getSharePreview call.
  target: { reviewId?: string; title: string | null };
}

export interface ReviewPreviewPayload {
  kind: "review";
  reviewId: string;
  title: string;
  arxivId: string | null;
  sourceUrl: string | null;
  /// Approximate counts. Used by the landing page to give visitors a
  /// sense of what they're importing without leaking raw content.
  counts: { messages: number; annotations: number };
}


export interface SharePreview {
  token: string;
  kind: ShareKind;
  createdAt: string;
  /// userId of the sharer. Returned so callers can compare against the
  /// session's userId without a second `share.findUnique` round-trip.
  ownerUserId: string;
  /// First name only on the public landing — full name shows up after
  /// auth. Avoids leaking surnames into Slack/Twitter unfurls.
  sharerFirstName: string | null;
  /// Full display name. Returned but rendered only post-auth.
  sharerName: string | null;
  /// Whether the viewer is the same user as the sharer (set by the
  /// caller — this module can't see the session). Default false.
  isOwner: boolean;
  payload: ReviewPreviewPayload;
}

/* ── Owner-side: create / list / revoke ───────────────────────── */

const DAILY_SHARE_LIMIT = 100;

interface CreateShareInput {
  kind: ShareKind;
  reviewId?: string;
}

/**
 * Create a share — or return an existing un-revoked share for the same
 * target by the same user. Idempotency means clicking "Create share
 * link" twice yields a stable URL.
 */
export async function createOrReuseShare(
  userId: string,
  input: CreateShareInput,
): Promise<{ token: string; createdAt: string; reused: boolean; importCount: number }> {
  if (!input.reviewId) throw new HttpError(400, "reviewId required");
  const review = await prisma.review.findFirst({
    where: { id: input.reviewId, userId },
    select: { id: true, arxivId: true, sourceUrl: true, title: true },
  });
  if (!review) throw new HttpError(404, "Review not found");
  // Match the export gate: only sharable when the recipient can
  // re-fetch the underlying document.
  if (!review.arxivId && !review.sourceUrl) {
    throw new HttpError(400, "Locally-uploaded PDFs cannot be shared");
  }

  const existing = await prisma.share.findFirst({
    where: { userId, kind: "review", reviewId: review.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return {
      token: existing.token,
      createdAt: existing.createdAt.toISOString(),
      reused: true,
      importCount: existing.importCount,
    };
  }

  await assertUnderDailyLimit(userId);
  const created = await prisma.share.create({
    data: {
      userId,
      kind: "review",
      reviewId: review.id,
    },
    select: { token: true, createdAt: true },
  });
  await sendSlackEvent(
    SlackEventType.ShareLinkCreated,
    `created share link for "${review.title}" (review ${review.id})`,
    userId,
  );
  return {
    token: created.token,
    createdAt: created.createdAt.toISOString(),
    reused: false,
    importCount: 0,
  };
}

async function assertUnderDailyLimit(userId: string): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.share.count({
    where: { userId, createdAt: { gte: since } },
  });
  if (recent >= DAILY_SHARE_LIMIT) {
    throw new HttpError(429, "Daily share limit reached");
  }
}

export async function listSharesForUser(userId: string): Promise<ShareSummary[]> {
  const rows = await prisma.share.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      review: { select: { id: true, title: true } },
    },
  });
  return rows.map((row) => ({
    token: row.token,
    kind: row.kind as ShareKind,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastAccessAt: row.lastAccessAt?.toISOString() ?? null,
    accessCount: row.accessCount,
    importCount: row.importCount,
    target: {
      reviewId: row.review?.id,
      title: row.review?.title ?? null,
    },
  }));
}

export async function revokeShare(userId: string, token: string): Promise<void> {
  const share = await prisma.share.findUnique({ where: { token } });
  if (!share) throw new HttpError(404, "Share not found");
  if (share.userId !== userId) throw new HttpError(403, "Forbidden");
  if (share.revokedAt) return; // already revoked, idempotent
  await prisma.share.update({
    where: { token },
    data: { revokedAt: new Date() },
  });
}

/* ── Public-facing: preview ───────────────────────────────────── */

/**
 * Hydrate a share token into a public-safe preview payload. Returns
 * null when the token doesn't exist or the underlying record was
 * deleted; throws HttpError(410) when the share was revoked. We
 * differentiate so the UI can distinguish "this link was revoked" from
 * a generic 404.
 */
export async function getSharePreview(token: string): Promise<SharePreview | null> {
  // Single round-trip for the share + sharer's name + review. Message and
  // annotation counts come from JSONB columns, fetched below.
  const share = await prisma.share.findUnique({
    where: { token },
    include: {
      user: { select: { name: true } },
      review: true,
    },
  });
  if (!share) return null;
  if (share.revokedAt) {
    throw new HttpError(410, "This share has been revoked");
  }

  const sharerName = share.user?.name ?? null;
  const sharerFirstName = sharerName ? sharerName.split(/\s+/)[0] || null : null;

  const review = share.review;
  if (!review) return null; // underlying deleted
  const [messagesRow, annotationsRow] = await Promise.all([
    prisma.reviewMessages.findUnique({
      where: { reviewId: review.id },
      select: { messages: true },
    }),
    prisma.reviewAnnotations.findUnique({
      where: { reviewId: review.id },
      select: { annotations: true },
    }),
  ]);
  const messages = Array.isArray(messagesRow?.messages)
    ? (messagesRow!.messages as unknown[]).length
    : 0;
  const annotations = Array.isArray(annotationsRow?.annotations)
    ? (annotationsRow!.annotations as unknown[]).length
    : 0;
  const payload: ReviewPreviewPayload = {
    kind: "review",
    reviewId: review.id,
    title: review.title,
    arxivId: review.arxivId,
    sourceUrl: review.sourceUrl,
    counts: { messages, annotations },
  };

  // Best-effort access bookkeeping. If this fails (e.g. read replica),
  // the preview still returns — telemetry is non-critical.
  void prisma.share
    .update({
      where: { token },
      data: { lastAccessAt: new Date(), accessCount: { increment: 1 } },
    })
    .catch(() => {});

  return {
    token: share.token,
    kind: share.kind as ShareKind,
    createdAt: share.createdAt.toISOString(),
    ownerUserId: share.userId,
    sharerName,
    sharerFirstName,
    isOwner: false,
    payload,
  };
}


/* ── Public-facing: import (clone) ────────────────────────────── */

export interface ImportShareResult {
  kind: ShareKind;
  /// For review imports: the id assigned in the recipient's account.
  finalReviewId?: string;
  /// Set when the recipient was already the owner — no clone happened,
  /// the navigation target is the original.
  alreadyOwner?: boolean;
}

const asJson = <T>(value: T): Prisma.InputJsonValue =>
  value as unknown as Prisma.InputJsonValue;

/**
 * Clone-import the share into the recipient's account. Reads owner's
 * row directly from Postgres — no untrusted bundle JSON ever touches
 * this path.
 */
export async function importShare(
  token: string,
  recipientUserId: string,
): Promise<ImportShareResult> {
  const share = await prisma.share.findUnique({ where: { token } });
  if (!share) throw new HttpError(404, "Share not found");
  if (share.revokedAt) throw new HttpError(410, "This share has been revoked");

  if (share.userId === recipientUserId) {
    if (share.reviewId) {
      return { kind: "review", finalReviewId: share.reviewId, alreadyOwner: true };
    }
  }

  const owner = await prisma.user.findUnique({
    where: { id: share.userId },
    select: { name: true },
  });
  const ownerDisplayName = owner?.name ?? null;

  const result = await importReviewShare(share, recipientUserId, ownerDisplayName);

  // Best-effort: a failed counter bump must not roll back a successful
  // clone. The counter is owner-facing telemetry, not a billing primitive.
  void prisma.share
    .update({
      where: { token },
      data: { importCount: { increment: 1 } },
    })
    .catch(() => {});

  return result;
}

async function importReviewShare(
  share: { token: string; userId: string; reviewId: string | null },
  recipientUserId: string,
  ownerDisplayName: string | null,
): Promise<ImportShareResult> {
  if (!share.reviewId) throw new HttpError(404, "Underlying review missing");
  const review = await prisma.review.findFirst({
    where: { id: share.reviewId, userId: share.userId },
  });
  if (!review) throw new HttpError(404, "Underlying review missing");

  const [messagesRow, annotationsRow] = await Promise.all([
    prisma.reviewMessages.findUnique({ where: { reviewId: review.id } }),
    prisma.reviewAnnotations.findUnique({ where: { reviewId: review.id } }),
  ]);

  // Recipient may already have a copy under the same id (e.g. they
  // imported this share before, or they share an environment). Always
  // mint a fresh id — clone semantics, never clobber.
  const finalReviewId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  await prisma.$transaction(async (tx) => {
    await tx.review.create({
      data: {
        id: finalReviewId,
        userId: recipientUserId,
        title: review.title,
        arxivId: review.arxivId,
        pdfPath: null,
        sourceUrl: review.sourceUrl,
        createdAt: review.createdAt,
        updatedAt: new Date(),
        importedAt: new Date(nowIso),
        importedFromShareToken: share.token,
        importedFromName: ownerDisplayName,
      },
    });

    if (messagesRow && Array.isArray(messagesRow.messages)) {
      const messages = messagesRow.messages as unknown[];
      if (messages.length > 0) {
        await tx.reviewMessages.create({
          data: { reviewId: finalReviewId, messages: asJson(messages) },
        });
      }
    }

    if (annotationsRow && Array.isArray(annotationsRow.annotations)) {
      const annotations = (annotationsRow.annotations as Array<Record<string, unknown>>).map(
        (a) => ({ ...a, reviewId: finalReviewId }),
      );
      if (annotations.length > 0) {
        await tx.reviewAnnotations.create({
          data: { reviewId: finalReviewId, annotations: asJson(annotations) },
        });
      }
    }
  });

  return { kind: "review", finalReviewId };
}
