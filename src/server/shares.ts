import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { HttpError } from "./api";
import { extractWikiLinkSlugs } from "@/lib/wiki-link-transform";
import { sendSlackEvent, SlackEventType } from "./notifications";

/* ── Types ────────────────────────────────────────────────────── */

export type ShareKind = "review" | "wiki";

export interface ShareSummary {
  token: string;
  kind: ShareKind;
  createdAt: string;
  revokedAt: string | null;
  lastAccessAt: string | null;
  accessCount: number;
  // Lightweight target identification — full payload comes from the
  // separate getSharePreview call.
  target: { reviewId?: string; wikiSlug?: string; title: string | null };
}

export interface ReviewPreviewPayload {
  kind: "review";
  reviewId: string;
  title: string;
  arxivId: string | null;
  sourceUrl: string | null;
  /// Approximate counts. Used by the landing page to give visitors a
  /// sense of what they're importing without leaking raw content.
  counts: { messages: number; annotations: number; deepDives: number };
}

export interface WikiPreviewPayload {
  kind: "wiki";
  rootSlug: string;
  rootTitle: string;
  pageType: "session" | "digest";
  /// First ~280 chars of the root page, sanitized for safe display in
  /// link unfurls and the landing page intro.
  excerpt: string;
  /// Depth selected by the sharer at link-creation time (0..3).
  depth: number;
  /// Estimated number of pages the recipient will receive after walking
  /// the link graph at `depth`. Computed once at preview time.
  pageCount: number;
}

export type SharePreviewPayload = ReviewPreviewPayload | WikiPreviewPayload;

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
  payload: SharePreviewPayload;
}

/* ── Owner-side: create / list / revoke ───────────────────────── */

const DAILY_SHARE_LIMIT = 100;

interface CreateShareInput {
  kind: ShareKind;
  reviewId?: string;
  wikiSlug?: string;
  /// For wiki shares: how many `[[link]]` hops to include. Clamped to
  /// [0, 3]. Default 0 (root page only) — the sharer must opt in to
  /// transitively sharing linked notes.
  wikiDepth?: number;
}

const MAX_WIKI_DEPTH = 3;

/**
 * Create a share — or return an existing un-revoked share for the same
 * target by the same user. Idempotency means clicking "Create share
 * link" twice yields a stable URL.
 */
export async function createOrReuseShare(
  userId: string,
  input: CreateShareInput,
): Promise<{ token: string; createdAt: string; reused: boolean }> {
  if (input.kind === "review") {
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
    };
  }

  // wiki
  if (!input.wikiSlug) throw new HttpError(400, "wikiSlug required");
  const page = await prisma.wikiPage.findUnique({
    where: { userId_slug: { userId, slug: input.wikiSlug } },
    select: { id: true, title: true },
  });
  if (!page) throw new HttpError(404, "Wiki page not found");

  const depth = clampDepth(input.wikiDepth);

  const existing = await prisma.share.findFirst({
    where: {
      userId,
      kind: "wiki",
      wikiPageId: page.id,
      wikiDepth: depth,
      revokedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return {
      token: existing.token,
      createdAt: existing.createdAt.toISOString(),
      reused: true,
    };
  }

  await assertUnderDailyLimit(userId);
  const created = await prisma.share.create({
    data: {
      userId,
      kind: "wiki",
      wikiPageId: page.id,
      wikiDepth: depth,
    },
    select: { token: true, createdAt: true },
  });
  await sendSlackEvent(
    SlackEventType.ShareLinkCreated,
    `created share link for "${page.title}" (wiki ${input.wikiSlug}, depth ${depth})`,
    userId,
  );
  return {
    token: created.token,
    createdAt: created.createdAt.toISOString(),
    reused: false,
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

function clampDepth(d: number | undefined): number {
  if (d === undefined || d === null || !Number.isFinite(d)) return 0;
  return Math.max(0, Math.min(MAX_WIKI_DEPTH, Math.trunc(d)));
}

export async function listSharesForUser(userId: string): Promise<ShareSummary[]> {
  const rows = await prisma.share.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      review: { select: { id: true, title: true } },
      page: { select: { slug: true, title: true } },
    },
  });
  return rows.map((row) => ({
    token: row.token,
    kind: row.kind as ShareKind,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastAccessAt: row.lastAccessAt?.toISOString() ?? null,
    accessCount: row.accessCount,
    target:
      row.kind === "review"
        ? {
            reviewId: row.review?.id,
            title: row.review?.title ?? null,
          }
        : {
            wikiSlug: row.page?.slug,
            title: row.page?.title ?? null,
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

const EXCERPT_CHARS = 280;

/**
 * Hydrate a share token into a public-safe preview payload. Returns
 * null when the token doesn't exist or the underlying record was
 * deleted; throws HttpError(410) when the share was revoked. We
 * differentiate so the UI can distinguish "this link was revoked" from
 * a generic 404.
 */
export async function getSharePreview(token: string): Promise<SharePreview | null> {
  // Single round-trip for the share + sharer's name + (review|page) + the
  // join-derived deepDive count. Messages/annotations are JSONB columns
  // so their lengths can't be _count'd — see the second fan-out below.
  const share = await prisma.share.findUnique({
    where: { token },
    include: {
      user: { select: { name: true } },
      review: {
        include: {
          _count: { select: { deepDives: true } },
        },
      },
      page: true,
    },
  });
  if (!share) return null;
  if (share.revokedAt) {
    throw new HttpError(410, "This share has been revoked");
  }

  const sharerName = share.user?.name ?? null;
  const sharerFirstName = sharerName ? sharerName.split(/\s+/)[0] || null : null;

  let payload: SharePreviewPayload;
  if (share.kind === "review") {
    if (!share.review) return null; // underlying deleted
    const review = share.review;
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
    payload = {
      kind: "review",
      reviewId: review.id,
      title: review.title,
      arxivId: review.arxivId,
      sourceUrl: review.sourceUrl,
      counts: {
        messages,
        annotations,
        deepDives: review._count.deepDives,
      },
    };
  } else {
    if (!share.page) return null;
    const page = share.page;
    const depth = share.wikiDepth ?? 0;
    const pageCount = await countWikiTraversal(share.userId, page.slug, depth);
    payload = {
      kind: "wiki",
      rootSlug: page.slug,
      rootTitle: page.title,
      pageType: page.pageType as "session" | "digest",
      excerpt: extractExcerpt(page.content, EXCERPT_CHARS),
      depth,
      pageCount,
    };
  }

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

async function countWikiTraversal(
  ownerUserId: string,
  rootSlug: string,
  depth: number,
): Promise<number> {
  if (depth <= 0) return 1;
  const seen = new Set<string>([rootSlug]);
  let frontier: string[] = [rootSlug];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const pages = await prisma.wikiPage.findMany({
      where: { userId: ownerUserId, slug: { in: frontier } },
      select: { content: true },
    });
    const next: string[] = [];
    for (const page of pages) {
      for (const target of extractWikiLinkSlugs(page.content)) {
        if (seen.has(target)) continue;
        // Only count slugs that actually resolve to a real page.
        const exists = await prisma.wikiPage.findUnique({
          where: { userId_slug: { userId: ownerUserId, slug: target } },
          select: { slug: true },
        });
        if (!exists) continue;
        seen.add(target);
        next.push(target);
      }
    }
    frontier = next;
  }
  return seen.size;
}

// Excerpt logic lives in @/lib/share-excerpt so it can be unit-tested
// without dragging in `server-only`.
import { extractExcerpt } from "@/lib/share-excerpt";

/* ── Public-facing: import (clone) ────────────────────────────── */

export interface ImportShareResult {
  kind: ShareKind;
  /// For review imports: the id assigned in the recipient's account.
  finalReviewId?: string;
  /// For wiki imports: slugs that were imported (may differ from
  /// originals after collision-rename).
  importedSlugs?: string[];
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
    if (share.kind === "review" && share.reviewId) {
      return { kind: "review", finalReviewId: share.reviewId, alreadyOwner: true };
    }
    if (share.kind === "wiki" && share.wikiPageId) {
      const page = await prisma.wikiPage.findUnique({
        where: { id: share.wikiPageId },
        select: { slug: true },
      });
      return {
        kind: "wiki",
        importedSlugs: page ? [page.slug] : [],
        alreadyOwner: true,
      };
    }
  }

  const owner = await prisma.user.findUnique({
    where: { id: share.userId },
    select: { name: true },
  });
  const ownerDisplayName = owner?.name ?? null;

  if (share.kind === "review") {
    return importReviewShare(share, recipientUserId, ownerDisplayName);
  }
  return importWikiShare(share, recipientUserId);
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

  const [messagesRow, annotationsRow, deepDives] = await Promise.all([
    prisma.reviewMessages.findUnique({ where: { reviewId: review.id } }),
    prisma.reviewAnnotations.findUnique({ where: { reviewId: review.id } }),
    prisma.deepDive.findMany({ where: { reviewId: review.id } }),
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

    for (const dd of deepDives) {
      await tx.deepDive.create({
        data: {
          id: crypto.randomUUID(),
          userId: recipientUserId,
          reviewId: finalReviewId,
          paperTitle: dd.paperTitle,
          arxivId: dd.arxivId,
          topic: dd.topic,
          explanation: dd.explanation,
          createdAt: dd.createdAt,
        },
      });
    }
  });

  return { kind: "review", finalReviewId };
}

async function importWikiShare(
  share: {
    token: string;
    userId: string;
    wikiPageId: string | null;
    wikiDepth: number | null;
  },
  recipientUserId: string,
): Promise<ImportShareResult> {
  if (!share.wikiPageId) throw new HttpError(404, "Underlying page missing");
  const root = await prisma.wikiPage.findFirst({
    where: { id: share.wikiPageId, userId: share.userId },
  });
  if (!root) throw new HttpError(404, "Underlying page missing");

  const depth = clampDepth(share.wikiDepth ?? 0);

  // Walk the owner's link graph at the chosen depth. Same algorithm as
  // the existing wiki bundle export, but reading directly instead of
  // round-tripping through JSON.
  const collected = new Map<string, {
    id: string;
    slug: string;
    title: string;
    content: string;
    pageType: string;
    createdAt: Date;
  }>();
  collected.set(root.slug, {
    id: root.id,
    slug: root.slug,
    title: root.title,
    content: root.content,
    pageType: root.pageType,
    createdAt: root.createdAt,
  });
  let frontier = [root];
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: typeof frontier = [];
    for (const page of frontier) {
      for (const targetSlug of extractWikiLinkSlugs(page.content)) {
        if (collected.has(targetSlug)) continue;
        const linked = await prisma.wikiPage.findUnique({
          where: { userId_slug: { userId: share.userId, slug: targetSlug } },
        });
        if (!linked) continue;
        collected.set(linked.slug, {
          id: linked.id,
          slug: linked.slug,
          title: linked.title,
          content: linked.content,
          pageType: linked.pageType,
          createdAt: linked.createdAt,
        });
        next.push(linked);
      }
    }
    frontier = next;
  }

  const importedSlugs: string[] = [];
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const [, page] of collected) {
      // Collision-rename strategy: if the recipient already has a page
      // at this slug, rename. Conservative — never clobber the
      // recipient's notes, even if the imported page looks identical.
      let targetSlug = page.slug;
      let attempt = 2;
      while (
        await tx.wikiPage.findUnique({
          where: { userId_slug: { userId: recipientUserId, slug: targetSlug } },
          select: { slug: true },
        })
      ) {
        targetSlug = `${page.slug}-imported${attempt === 2 ? "" : `-${attempt}`}`;
        attempt++;
      }
      const targetId = crypto.randomUUID();
      await tx.wikiPage.create({
        data: {
          id: targetId,
          userId: recipientUserId,
          slug: targetSlug,
          title: page.title,
          content: page.content,
          pageType: page.pageType,
          createdAt: now,
          updatedAt: now,
        },
      });

      const links = extractWikiLinkSlugs(page.content);
      if (links.length > 0) {
        await tx.wikiBacklink.createMany({
          data: links.map((targetLink) => ({
            userId: recipientUserId,
            sourceId: targetId,
            targetSlug: targetLink,
          })),
          skipDuplicates: true,
        });
      }
      importedSlugs.push(targetSlug);
    }
  });

  return { kind: "wiki", importedSlugs };
}
