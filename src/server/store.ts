import "server-only";
import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import type { Annotation } from "@/lib/annotations";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type { ArtifactContent, ReviewArtifact } from "@/lib/artifacts";
import type {
  ChatMessage,
  ContextMetadata,
  PaperReview,
  Project,
} from "@/lib/review-types";
import type { WikiPage, WikiPageType } from "@/lib/wiki";
import type {
  DiscoverQuery,
  DiscoverQueryStatus,
  Recommendation,
} from "@/lib/discover-types";
import { extractWikiLinkSlugs } from "@/lib/wiki-link-transform";
import { normalizeArxivId } from "@/lib/arxiv";
import { arxivIdFromUrl, type ParsedPick } from "@/lib/picks-parser";
import { HttpError } from "./api";
import { sendSlackEvent, SlackEventType } from "./notifications";
import { judgeAvailable, judgePicks } from "./judge";
import { orderByJudge, type JudgeDetail } from "@/lib/judge-rubric";

/* ── Reviews ──────────────────────────────────────────────────── */

export async function listReviews(userId: string): Promise<PaperReview[]> {
  // Most recently active first: `updatedAt` is bumped on every chat and note
  // write (see `touchReviewOp`), so it tracks the user's last interaction.
  const rows = await prisma.review.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(rowToReview);
}

export async function getReview(
  userId: string,
  id: string,
): Promise<PaperReview | null> {
  const row = await prisma.review.findFirst({ where: { id, userId } });
  return row ? rowToReview(row) : null;
}

export async function getReviewByArxivId(
  userId: string,
  arxivId: string,
): Promise<PaperReview | null> {
  const target = normalizeArxivId(arxivId);
  // Match against all the user's reviews, normalizing both sides.
  const rows = await prisma.review.findMany({
    where: { userId, arxivId: { not: null } },
  });
  const hit = rows.find(
    (r) => r.arxivId && normalizeArxivId(r.arxivId) === target,
  );
  return hit ? rowToReview(hit) : null;
}

export async function getReviewBySourceUrl(
  userId: string,
  sourceUrl: string,
): Promise<PaperReview | null> {
  const row = await prisma.review.findFirst({
    where: { userId, sourceUrl },
  });
  return row ? rowToReview(row) : null;
}

export async function insertReview(
  userId: string,
  review: PaperReview,
  /**
   * When the review is being created from a Discover recommendation, pass
   * the rec id so the FK is set atomically. Stays null for paste-link, PDF
   * upload, web review, and import flows.
   */
  fromRecommendationId?: string | null,
  projectId?: string | null,
): Promise<PaperReview> {
  const row = await prisma.review.create({
    data: {
      id: review.id,
      userId,
      title: review.title,
      arxivId: review.arxivId,
      pdfPath: review.pdfPath,
      sourceUrl: review.sourceUrl,
      createdAt: new Date(review.createdAt),
      updatedAt: new Date(review.updatedAt),
      importedAt: review.importedAt ? new Date(review.importedAt) : null,
      fromRecommendationId: fromRecommendationId ?? null,
      projectId: projectId ?? null,
    },
  });
  if (!review.importedAt) {
    await sendSlackEvent(
      SlackEventType.ReviewInitiated,
      `started review: ${review.title} (${review.id})`,
      userId,
    );
  }
  return rowToReview(row);
}

/**
 * Rename a review. Bumps updatedAt. Returns the updated review or null when
 * the row isn't owned by this user or doesn't exist.
 */
export async function updateReviewTitle(
  userId: string,
  reviewId: string,
  title: string,
): Promise<PaperReview | null> {
  const existing = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true },
  });
  if (!existing) return null;
  const row = await prisma.review.update({
    where: { id: reviewId },
    data: { title, updatedAt: new Date() },
  });
  return rowToReview(row);
}

/** Delete a review and the PDF blob it owns. Cascades take care of the rest. */
export async function deleteReview(
  userId: string,
  id: string,
): Promise<{ pdfPath: string | null } | null> {
  const existing = await prisma.review.findFirst({ where: { id, userId } });
  if (!existing) return null;
  await prisma.review.delete({ where: { id } });
  return { pdfPath: existing.pdfPath };
}

function rowToReview(r: {
  id: string;
  title: string;
  arxivId: string | null;
  pdfPath: string | null;
  sourceUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  importedAt: Date | null;
  importedFromShareToken?: string | null;
  importedFromName?: string | null;
  projectId?: string | null;
  documentId?: string | null;
}): PaperReview {
  return {
    id: r.id,
    title: r.title,
    arxivId: r.arxivId,
    pdfPath: r.pdfPath,
    sourceUrl: r.sourceUrl,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    projectId: r.projectId ?? null,
    documentId: r.documentId ?? null,
    ...(r.importedAt ? { importedAt: r.importedAt.toISOString() } : {}),
    ...(r.importedFromShareToken
      ? { importedFromShareToken: r.importedFromShareToken }
      : {}),
    ...(r.importedFromName ? { importedFromName: r.importedFromName } : {}),
  };
}

/* ── Messages / annotations ──────────────────────────────────── */

/** Bump a review's `updatedAt` to now. Chat and note writes run this in the
 *  same transaction so the library's recency order reflects the last
 *  interaction, not creation time. */
function touchReviewOp(reviewId: string) {
  return prisma.review.update({
    where: { id: reviewId },
    data: { updatedAt: new Date() },
  });
}

async function assertReviewOwned(userId: string, reviewId: string): Promise<void> {
  const exists = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true },
  });
  if (!exists) throw new HttpError(404, `Review not found: ${reviewId}`);
}

export async function getMessages(
  userId: string,
  reviewId: string,
): Promise<ChatMessage[]> {
  await assertReviewOwned(userId, reviewId);
  const row = await prisma.reviewMessages.findUnique({ where: { reviewId } });
  return (row?.messages as unknown as ChatMessage[] | undefined) ?? [];
}

/**
 * Load a conversation's messages plus its `contextMetadata` (compaction record
 * + last measured context size) in one read. Use this on paths that need the
 * context state — the usage meter, compaction-aware transcript build, and the
 * compaction endpoint.
 */
export async function getConversation(
  userId: string,
  reviewId: string,
): Promise<{ messages: ChatMessage[]; contextMetadata: ContextMetadata | null }> {
  await assertReviewOwned(userId, reviewId);
  const row = await prisma.reviewMessages.findUnique({ where: { reviewId } });
  return {
    messages: (row?.messages as unknown as ChatMessage[] | undefined) ?? [],
    contextMetadata:
      (row?.contextMetadata as unknown as ContextMetadata | null | undefined) ??
      null,
  };
}

/**
 * Update only the `contextMetadata` column, leaving `messages` untouched.
 * Used by the compaction endpoint, which records a recap without mutating the
 * raw history. No-ops with a 404 if the conversation row doesn't exist yet
 * (nothing to compact).
 */
export async function setContextMetadata(
  userId: string,
  reviewId: string,
  contextMetadata: ContextMetadata,
): Promise<void> {
  await assertReviewOwned(userId, reviewId);
  await prisma.reviewMessages.update({
    where: { reviewId },
    data: {
      contextMetadata: contextMetadata as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function setMessages(
  userId: string,
  reviewId: string,
  messages: ChatMessage[],
  contextMetadata?: ContextMetadata,
): Promise<void> {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true, title: true },
  });
  if (!review) throw new HttpError(404, `Review not found: ${reviewId}`);
  const prior = await prisma.reviewMessages.findUnique({
    where: { reviewId },
    select: { messages: true },
  });
  const priorMsgs =
    (prior?.messages as unknown as ChatMessage[] | undefined) ?? [];
  // Only touch the metadata column when the caller supplies it, so callers
  // that just persist messages don't clobber an existing compaction record.
  const metaData =
    contextMetadata !== undefined
      ? { contextMetadata: contextMetadata as unknown as Prisma.InputJsonValue }
      : {};
  await prisma.$transaction([
    prisma.reviewMessages.upsert({
      where: { reviewId },
      create: {
        reviewId,
        messages: messages as unknown as Prisma.InputJsonValue,
        ...metaData,
      },
      update: {
        messages: messages as unknown as Prisma.InputJsonValue,
        ...metaData,
      },
    }),
    touchReviewOp(reviewId),
  ]);
  // Fire when a new user-authored message has appeared in this save.
  // Persistence happens after streaming, so by the time we see it the
  // assistant reply is usually the tail; we still want to count the user
  // turn that triggered it.
  const priorIds = new Set(priorMsgs.map((m) => m.id));
  const addedUser = messages.find(
    (m) => m.role === "user" && !priorIds.has(m.id),
  );
  if (addedUser) {
    await sendSlackEvent(
      SlackEventType.ReviewMessageSent,
      `sent message in "${review.title}" (${reviewId})`,
      userId,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Artifacts                                                          */
/* ------------------------------------------------------------------ */

function toArtifact(row: {
  id: string;
  reviewId: string;
  title: string;
  summary: string;
  html: string;
  createdAt: Date;
}): ReviewArtifact {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** A review's artifacts, newest first. */
export async function listArtifacts(
  userId: string,
  reviewId: string,
): Promise<ReviewArtifact[]> {
  await assertReviewOwned(userId, reviewId);
  const rows = await prisma.reviewArtifact.findMany({
    where: { reviewId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toArtifact);
}

/** Save artifacts produced in a chat turn. `sourceCallId` dedupes a retried
 *  persist of the same turn. */
export async function saveArtifacts(
  userId: string,
  reviewId: string,
  artifacts: Array<ArtifactContent & { sourceCallId: string }>,
): Promise<void> {
  if (artifacts.length === 0) return;
  await assertReviewOwned(userId, reviewId);
  await prisma.reviewArtifact.createMany({
    data: artifacts.map((a) => ({ ...a, reviewId })),
    skipDuplicates: true,
  });
}

export async function getAnnotations(
  userId: string,
  reviewId: string,
): Promise<Annotation[]> {
  await assertReviewOwned(userId, reviewId);
  const row = await prisma.reviewAnnotations.findUnique({ where: { reviewId } });
  return (row?.annotations as unknown as Annotation[] | undefined) ?? [];
}

export async function setAnnotations(
  userId: string,
  reviewId: string,
  annotations: Annotation[],
): Promise<void> {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true, title: true },
  });
  if (!review) throw new HttpError(404, `Review not found: ${reviewId}`);
  const prior = await prisma.reviewAnnotations.findUnique({
    where: { reviewId },
    select: { annotations: true },
  });
  const priorAnns =
    (prior?.annotations as unknown as Annotation[] | undefined) ?? [];
  await prisma.$transaction([
    prisma.reviewAnnotations.upsert({
      where: { reviewId },
      create: {
        reviewId,
        annotations: annotations as unknown as Prisma.InputJsonValue,
      },
      update: {
        annotations: annotations as unknown as Prisma.InputJsonValue,
      },
    }),
    touchReviewOp(reviewId),
  ]);
  const priorIds = new Set(priorAnns.map((a) => a.id));
  const added = annotations.filter((a) => !priorIds.has(a.id));
  for (const a of added) {
    if (a.kind === "ask_ai") {
      // "Dive deeper" / ask-AI from a selection is conversational, not a note.
      await sendSlackEvent(
        SlackEventType.ReviewMessageSent,
        `dove deeper on "${review.title}" (p.${a.pageNumber})`,
        userId,
      );
    } else {
      await sendSlackEvent(
        SlackEventType.NoteAdded,
        `added note on "${review.title}" (p.${a.pageNumber})`,
        userId,
      );
    }
  }
}

/* ── Deep dives ───────────────────────────────────────────────── */

export async function listDeepDives(userId: string): Promise<DeepDiveSession[]> {
  const rows = await prisma.deepDive.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((d) => ({
    id: d.id,
    reviewId: d.reviewId,
    paperTitle: d.paperTitle,
    arxivId: d.arxivId,
    topic: d.topic,
    explanation: d.explanation,
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function insertDeepDive(
  userId: string,
  session: DeepDiveSession,
): Promise<DeepDiveSession> {
  await assertReviewOwned(userId, session.reviewId);
  const row = await prisma.deepDive.create({
    data: {
      id: session.id,
      userId,
      reviewId: session.reviewId,
      paperTitle: session.paperTitle,
      arxivId: session.arxivId,
      topic: session.topic,
      explanation: session.explanation,
      createdAt: new Date(session.createdAt),
    },
  });
  return {
    id: row.id,
    reviewId: row.reviewId,
    paperTitle: row.paperTitle,
    arxivId: row.arxivId,
    topic: row.topic,
    explanation: row.explanation,
    createdAt: row.createdAt.toISOString(),
  };
}

/* ── Wiki ─────────────────────────────────────────────────────── */

function rowToWikiPage(r: {
  id: string;
  slug: string;
  title: string;
  content: string;
  pageType: string;
  createdAt: Date;
  updatedAt: Date;
}): WikiPage {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    content: r.content,
    pageType: r.pageType as WikiPageType,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listWikiPages(userId: string): Promise<WikiPage[]> {
  const rows = await prisma.wikiPage.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(rowToWikiPage);
}

export async function getWikiPageBySlug(
  userId: string,
  slug: string,
): Promise<WikiPage | null> {
  const row = await prisma.wikiPage.findUnique({
    where: { userId_slug: { userId, slug } },
  });
  return row ? rowToWikiPage(row) : null;
}

export interface UpsertWikiPageInput {
  id: string;
  slug: string;
  title: string;
  content: string;
  pageType: WikiPageType;
}

/**
 * Upsert a wiki page in a single transaction: archive the prior content as
 * a revision (when changed), write the new row, and rebuild backlinks.
 */
export async function upsertWikiPage(
  userId: string,
  page: UpsertWikiPageInput,
): Promise<WikiPage> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const existing = await tx.wikiPage.findUnique({
      where: { userId_slug: { userId, slug: page.slug } },
    });
    const finalId = existing?.id ?? page.id;
    const createdAt = existing?.createdAt ?? now;

    if (existing && existing.content !== page.content) {
      await tx.wikiRevision.create({
        data: {
          userId,
          pageId: existing.id,
          slug: page.slug,
          title: existing.title,
          content: existing.content,
          pageType: existing.pageType,
          savedAt: now,
        },
      });
    }

    await tx.wikiPage.upsert({
      where: { userId_slug: { userId, slug: page.slug } },
      create: {
        id: finalId,
        userId,
        slug: page.slug,
        title: page.title,
        content: page.content,
        pageType: page.pageType,
        createdAt,
        updatedAt: now,
      },
      update: {
        title: page.title,
        content: page.content,
        pageType: page.pageType,
        updatedAt: now,
      },
    });

    await rebuildBacklinks(tx, userId, finalId, page.content);

    const saved = await tx.wikiPage.findUnique({
      where: { userId_slug: { userId, slug: page.slug } },
    });
    return rowToWikiPage(saved!);
  });
}

export async function deleteWikiPageBySlug(
  userId: string,
  slug: string,
): Promise<void> {
  await prisma.wikiPage.deleteMany({ where: { userId, slug } });
}

export async function addWikiPageSource(
  userId: string,
  pageId: string,
  reviewId: string,
): Promise<void> {
  await prisma.wikiPageSource.upsert({
    where: { pageId_reviewId: { pageId, reviewId } },
    create: { userId, pageId, reviewId, addedAt: new Date(), passage: null },
    update: {},
  });
}

export async function hasWikiSourcesForReview(
  userId: string,
  reviewId: string,
): Promise<boolean> {
  const hit = await prisma.wikiPageSource.findFirst({
    where: { userId, reviewId },
    select: { pageId: true },
  });
  return !!hit;
}

export interface WikiBacklink {
  sourceSlug: string;
  sourceTitle: string;
  sourcePageType: WikiPageType;
}

export async function getWikiBacklinks(
  userId: string,
  slug: string,
): Promise<WikiBacklink[]> {
  const links = await prisma.wikiBacklink.findMany({
    where: { userId, targetSlug: slug },
    include: { source: true },
  });
  return links
    .map((l) => ({
      sourceSlug: l.source.slug,
      sourceTitle: l.source.title,
      sourcePageType: l.source.pageType as WikiPageType,
    }))
    .sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle));
}

export interface WikiPageSource {
  reviewId: string;
  reviewTitle: string | null;
  reviewArxivId: string | null;
  passage: string | null;
  addedAt: string | null;
}

export async function getWikiPageSources(
  userId: string,
  slug: string,
): Promise<WikiPageSource[]> {
  const page = await prisma.wikiPage.findUnique({
    where: { userId_slug: { userId, slug } },
  });
  if (!page) return [];
  const sources = await prisma.wikiPageSource.findMany({
    where: { userId, pageId: page.id },
    include: { review: true },
    orderBy: { addedAt: "desc" },
  });
  return sources.map((s) => ({
    reviewId: s.reviewId,
    reviewTitle: s.review?.title ?? null,
    reviewArxivId: s.review?.arxivId ?? null,
    passage: s.passage,
    addedAt: s.addedAt.toISOString(),
  }));
}

export interface WikiRevisionSummary {
  id: string;
  savedAt: string;
  contentLength: number;
}

export async function listWikiRevisions(
  userId: string,
  slug: string,
): Promise<WikiRevisionSummary[]> {
  const page = await prisma.wikiPage.findUnique({
    where: { userId_slug: { userId, slug } },
  });
  if (!page) return [];
  const rows = await prisma.wikiRevision.findMany({
    where: { userId, pageId: page.id },
    orderBy: { savedAt: "desc" },
    take: 20,
  });
  return rows.map((r) => ({
    id: r.id,
    savedAt: r.savedAt.toISOString(),
    contentLength: r.content.length,
  }));
}

export async function getWikiRevision(
  userId: string,
  id: string,
): Promise<{
  id: string;
  slug: string;
  title: string;
  content: string;
  savedAt: string;
} | null> {
  const row = await prisma.wikiRevision.findFirst({
    where: { id, userId },
  });
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    savedAt: row.savedAt.toISOString(),
  };
}

export async function listSessionPagesInRange(
  userId: string,
  startDateKey: string,
  endDateKey: string,
): Promise<
  Array<{ slug: string; title: string; content: string; updatedAt: string }>
> {
  const rows = await prisma.wikiPage.findMany({
    where: {
      userId,
      pageType: "session",
      slug: { gte: `session-${startDateKey}`, lte: `session-${endDateKey}` },
    },
    orderBy: { slug: "asc" },
  });
  return rows.map((p) => ({
    slug: p.slug,
    title: p.title,
    content: p.content,
    updatedAt: p.updatedAt.toISOString(),
  }));
}

/* ── Wiki ingest ──────────────────────────────────────────────── */

export interface IngestFinalizeInput {
  pages: Array<{
    slug: string;
    title: string;
    content: string;
    pageType: WikiPageType;
    source?: { reviewId: string; passage?: string };
  }>;
}

export async function wikiIngestFinalize(
  userId: string,
  input: IngestFinalizeInput,
): Promise<{ savedSlugs: string[] }> {
  const savedSlugs: string[] = [];
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    for (const page of input.pages) {
      if (!page.slug || !page.title || !page.content || !page.pageType) continue;

      const existing = await tx.wikiPage.findUnique({
        where: { userId_slug: { userId, slug: page.slug } },
      });
      const id = existing?.id ?? crypto.randomUUID();
      const createdAt = existing?.createdAt ?? now;

      if (existing && existing.content !== page.content) {
        await tx.wikiRevision.create({
          data: {
            userId,
            pageId: id,
            slug: page.slug,
            title: existing.title,
            content: existing.content,
            pageType: existing.pageType,
            savedAt: now,
          },
        });
      }

      await tx.wikiPage.upsert({
        where: { userId_slug: { userId, slug: page.slug } },
        create: {
          id,
          userId,
          slug: page.slug,
          title: page.title,
          content: page.content,
          pageType: page.pageType,
          createdAt,
          updatedAt: now,
        },
        update: {
          title: page.title,
          content: page.content,
          pageType: page.pageType,
          updatedAt: now,
        },
      });

      await rebuildBacklinks(tx, userId, id, page.content);

      if (page.source) {
        await tx.wikiPageSource.upsert({
          where: { pageId_reviewId: { pageId: id, reviewId: page.source.reviewId } },
          create: {
            userId,
            pageId: id,
            reviewId: page.source.reviewId,
            passage: page.source.passage ?? null,
            addedAt: now,
          },
          update: page.source.passage
            ? { passage: page.source.passage }
            : {},
        });
      }

      savedSlugs.push(page.slug);
    }
  });
  return { savedSlugs };
}

async function rebuildBacklinks(
  tx: Prisma.TransactionClient,
  userId: string,
  pageId: string,
  content: string,
): Promise<void> {
  await tx.wikiBacklink.deleteMany({ where: { userId, sourceId: pageId } });
  const targets = extractWikiLinkSlugs(content);
  if (targets.length === 0) return;
  await tx.wikiBacklink.createMany({
    data: targets.map((targetSlug) => ({
      userId,
      sourceId: pageId,
      targetSlug,
    })),
    skipDuplicates: true,
  });
}

/* ── Settings ─────────────────────────────────────────────────── */

import { decrypt, encrypt } from "./crypto";

/** Pseudo-provider identifying the Exa Search tool key in the ApiKey table. */
const EXA_PROVIDER = "exa";
/** Provider slug for the user's optional Fireworks key override. */
const FIREWORKS_PROVIDER = "fireworks";

export interface SettingsSnapshot {
  /** User's optional Fireworks key override (server falls back to env). */
  fireworksKey: string | null;
  exaApiKey: string | null;
}

export async function getSettings(userId: string): Promise<SettingsSnapshot> {
  const apiKeys = await prisma.apiKey.findMany({ where: { userId } });

  let fireworksKey: string | null = null;
  let exaApiKey: string | null = null;
  for (const row of apiKeys) {
    if (row.provider === FIREWORKS_PROVIDER) {
      fireworksKey = decrypt(row.value);
    } else if (row.provider === EXA_PROVIDER) {
      exaApiKey = decrypt(row.value);
    }
    // Any other rows (legacy per-provider keys: anthropic/openai/xai/brave)
    // are ignored — the app now uses a single Fireworks key.
  }

  return { fireworksKey, exaApiKey };
}

export interface SettingsPatch {
  fireworksKey?: string | null;
  exaApiKey?: string | null;
}

export async function patchSettings(
  userId: string,
  patch: SettingsPatch,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const upsertKey = (provider: string, value: string) =>
      tx.apiKey.upsert({
        where: { userId_provider: { userId, provider } },
        create: { userId, provider, value: encrypt(value) },
        update: { value: encrypt(value) },
      });
    const deleteKey = (provider: string) =>
      tx.apiKey.deleteMany({ where: { userId, provider } });

    const applyKey = async (provider: string, v: string | null | undefined) => {
      if (v === null || v === undefined || v === "") {
        await deleteKey(provider);
      } else {
        await upsertKey(provider, v);
      }
    };

    if ("fireworksKey" in patch) {
      await applyKey(FIREWORKS_PROVIDER, patch.fireworksKey);
    }
    if ("exaApiKey" in patch) {
      await applyKey(EXA_PROVIDER, patch.exaApiKey);
    }
  });
}

/* ── PDF blobs ───────────────────────────────────────────────── */

export interface PdfBlobMeta {
  id: string;
  storagePath: string;
  name: string | null;
}

export async function recordPdfBlob(
  userId: string,
  id: string,
  storagePath: string,
  name: string | null,
): Promise<void> {
  await prisma.pdfBlob.create({
    data: { id, userId, storagePath, name, createdAt: new Date() },
  });
}

export async function getPdfBlob(
  userId: string,
  id: string,
): Promise<PdfBlobMeta | null> {
  const row = await prisma.pdfBlob.findFirst({ where: { id, userId } });
  return row
    ? { id: row.id, storagePath: row.storagePath, name: row.name }
    : null;
}

export async function deletePdfBlobRecord(
  userId: string,
  id: string,
): Promise<string | null> {
  const row = await prisma.pdfBlob.findFirst({ where: { id, userId } });
  if (!row) return null;
  await prisma.pdfBlob.delete({ where: { id } });
  return row.storagePath;
}

/* ── Discover queries + recommendations ───────────────────────── */

interface DiscoverQueryRow {
  id: string;
  query: string;
  notes: string | null;
  status: string;
  createdAt: Date;
  projectId: string | null;
}

interface RecommendationRow {
  id: string;
  queryId: string;
  rank: number;
  url: string;
  title: string;
  rationale: string;
  arxivId: string | null;
  authors: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  venue: string | null;
  citationCount: number | null;
  judgeScore: number | null;
  judgeDetail: unknown;
  dismissedAt: Date | null;
  createdAt: Date;
}

function rowToDiscoverQuery(r: DiscoverQueryRow): DiscoverQuery {
  return {
    id: r.id,
    query: r.query,
    notes: r.notes,
    status: r.status as DiscoverQueryStatus,
    createdAt: r.createdAt.toISOString(),
    projectId: r.projectId,
  };
}

function rowToRecommendation(r: RecommendationRow): Recommendation {
  return {
    id: r.id,
    queryId: r.queryId,
    rank: r.rank,
    url: r.url,
    title: r.title,
    rationale: r.rationale,
    arxivId: r.arxivId,
    authors: r.authors,
    publishedDate: r.publishedDate,
    publishedYear: r.publishedYear,
    venue: r.venue,
    citationCount: r.citationCount,
    judgeScore: r.judgeScore,
    judgeDetail: (r.judgeDetail as JudgeDetail | null) ?? null,
    dismissedAt: r.dismissedAt ? r.dismissedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

async function assertDiscoverQueryOwned(
  userId: string,
  queryId: string,
): Promise<void> {
  const exists = await prisma.discoverQuery.findFirst({
    where: { id: queryId, userId },
    select: { id: true },
  });
  if (!exists)
    throw new HttpError(404, `Discover query not found: ${queryId}`);
}

async function assertRecommendationOwned(
  userId: string,
  recId: string,
): Promise<void> {
  const exists = await prisma.recommendation.findFirst({
    where: { id: recId, query: { userId } },
    select: { id: true },
  });
  if (!exists)
    throw new HttpError(404, `Recommendation not found: ${recId}`);
}

async function assertProjectOwned(
  userId: string,
  projectId: string,
): Promise<void> {
  const exists = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!exists) throw new HttpError(404, `Project not found: ${projectId}`);
}

export async function createDiscoverQuery(
  userId: string,
  query: string,
  projectId: string | null = null,
): Promise<DiscoverQuery> {
  if (projectId) await assertProjectOwned(userId, projectId);
  const row = await prisma.discoverQuery.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      query,
      status: "running",
      createdAt: new Date(),
      projectId,
    },
  });
  await sendSlackEvent(
    SlackEventType.DiscoveryInitiated,
    `started discovery: ${query}`,
    userId,
  );
  return rowToDiscoverQuery(row);
}

/**
 * Finalize a discover query: persist the agent's auxiliary notes, mark
 * status, and write Recommendation rows for the parsed picks. Idempotent
 * on re-call only in the sense that it overwrites notes/status; existing
 * recommendation rows are NOT cleared (callers should only finalize once
 * per query).
 */
export async function finalizeDiscoverQuery(
  userId: string,
  queryId: string,
  payload: {
    notes: string | null;
    picks: ParsedPick[];
    status: Exclude<DiscoverQueryStatus, "running">;
  },
): Promise<{ query: DiscoverQuery; recommendations: Recommendation[] }> {
  await assertDiscoverQueryOwned(userId, queryId);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.discoverQuery.update({
      where: { id: queryId },
      data: { notes: payload.notes, status: payload.status },
    });
    const created: RecommendationRow[] = [];
    for (let i = 0; i < payload.picks.length; i++) {
      const pick = payload.picks[i];
      const row = await tx.recommendation.create({
        data: {
          id: crypto.randomUUID(),
          queryId,
          // 1-indexed: the agent's preference order, surfaced in the queue.
          rank: i + 1,
          url: pick.url,
          title: pick.title,
          rationale: pick.rationale,
          // Prefer the agent-provided arxiv id (from submit_picks); fall
          // back to URL extraction for the markdown-parser path.
          arxivId: pick.arxivId ?? arxivIdFromUrl(pick.url),
          authors: pick.authors ?? null,
          publishedDate: pick.publishedDate ?? null,
          publishedYear: pick.publishedYear ?? null,
          venue: pick.venue ?? null,
          citationCount: pick.citationCount ?? null,
          // Screened by the funnel: keep its content-based score. Picks
          // without one are judged below.
          judgeScore: pick.judgeScore ?? null,
          ...(pick.judgeDetail
            ? { judgeDetail: pick.judgeDetail as Prisma.InputJsonValue }
            : {}),
          createdAt: now,
        },
      });
      created.push(row);
    }
    return { query: updated, recs: created };
  });

  // Score the picks and reorder them by the judge. Best-effort: without a
  // key, or if judging fails, the agent's order stands.
  const recommendations =
    result.recs.length > 0
      ? await judgeQueryRecommendations(queryId)
      : [];

  return {
    query: rowToDiscoverQuery(result.query),
    recommendations:
      recommendations.length > 0
        ? recommendations
        : result.recs.map(rowToRecommendation),
  };
}

/**
 * Judge a brief's unscored picks and, once every pick has a score, renumber
 * `rank` in the judge's order. The judge sees the brief's question and its
 * project's name, so scores are comparable across a project's briefs.
 * Returns the brief's recommendations (empty when judging is unavailable).
 * Never throws: judging only ever improves on the agent's order.
 */
async function judgeQueryRecommendations(
  queryId: string,
): Promise<Recommendation[]> {
  if (!judgeAvailable()) return [];
  try {
    const query = await prisma.discoverQuery.findUnique({
      where: { id: queryId },
      select: { query: true, project: { select: { name: true } } },
    });
    if (!query) return [];
    const recs = await prisma.recommendation.findMany({
      where: { queryId },
      orderBy: { rank: "asc" },
    });
    const unscored = recs.filter((r) => r.judgeScore === null);
    if (unscored.length > 0) {
      const results = await judgePicks(
        { question: query.query, projectName: query.project?.name ?? null },
        unscored.map((r) => ({
          title: r.title,
          url: r.url,
          rationale: r.rationale,
          arxivId: r.arxivId,
          authors: r.authors,
          publishedYear: r.publishedYear,
          venue: r.venue,
        })),
      );
      await Promise.all(
        unscored.map((r, i) => {
          const result = results[i];
          if (!result) return null;
          r.judgeScore = result.score;
          r.judgeDetail = result.detail as unknown as Prisma.JsonValue;
          return prisma.recommendation.update({
            where: { id: r.id },
            data: {
              judgeScore: result.score,
              judgeDetail: result.detail as unknown as Prisma.InputJsonValue,
            },
          });
        }),
      );
    }

    // Renumber only when every pick is scored; a partial result would push
    // the unscored ones to the bottom for no reason.
    if (recs.every((r) => r.judgeScore !== null)) {
      const ordered = orderByJudge(recs, (r) => r.judgeScore);
      const changed = ordered.filter((r, i) => r.rank !== i + 1);
      if (changed.length > 0) {
        await prisma.$transaction(
          ordered.map((r, i) =>
            prisma.recommendation.update({
              where: { id: r.id },
              data: { rank: i + 1 },
            }),
          ),
        );
        ordered.forEach((r, i) => (r.rank = i + 1));
      }
      return ordered.map(rowToRecommendation);
    }
    return recs.map(rowToRecommendation);
  } catch (err) {
    console.error("Judging recommendations failed", {
      queryId,
      error: err instanceof Error ? err.message : err,
    });
    return [];
  }
}

/**
 * Judge the unscored picks of some of the user's briefs (picks saved before
 * the judge existed, or whose judging failed). Returns the briefs' updated
 * recommendations; `available` is false when no judge is configured.
 */
export async function judgeBriefs(
  userId: string,
  queryIds: string[],
): Promise<{ available: boolean; recommendations: Recommendation[] }> {
  if (!judgeAvailable()) return { available: false, recommendations: [] };
  const owned = await prisma.discoverQuery.findMany({
    where: { id: { in: queryIds }, userId },
    select: { id: true },
  });
  const updated: Recommendation[] = [];
  for (const q of owned) {
    updated.push(...(await judgeQueryRecommendations(q.id)));
  }
  return { available: true, recommendations: updated };
}

export async function listDiscoverQueries(
  userId: string,
): Promise<DiscoverQuery[]> {
  const rows = await prisma.discoverQuery.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToDiscoverQuery);
}

export async function listRecommendations(
  userId: string,
): Promise<Recommendation[]> {
  const rows = await prisma.recommendation.findMany({
    where: { query: { userId } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToRecommendation);
}

export async function getRecommendation(
  userId: string,
  recId: string,
): Promise<Recommendation | null> {
  const row = await prisma.recommendation.findFirst({
    where: { id: recId, query: { userId } },
  });
  return row ? rowToRecommendation(row) : null;
}

export async function dismissRecommendation(
  userId: string,
  recId: string,
): Promise<Recommendation> {
  await assertRecommendationOwned(userId, recId);
  const row = await prisma.recommendation.update({
    where: { id: recId },
    data: { dismissedAt: new Date() },
  });
  return rowToRecommendation(row);
}

export async function undismissRecommendation(
  userId: string,
  recId: string,
): Promise<Recommendation> {
  await assertRecommendationOwned(userId, recId);
  const row = await prisma.recommendation.update({
    where: { id: recId },
    data: { dismissedAt: null },
  });
  return rowToRecommendation(row);
}

/**
 * Link a brief to a project (or unlink with null). Reviews already opened
 * from its recommendations come along when they aren't in a project yet;
 * reviews filed elsewhere stay where the user put them.
 */
export async function setDiscoverQueryProject(
  userId: string,
  queryId: string,
  projectId: string | null,
): Promise<{ query: DiscoverQuery; movedReviewIds: string[] }> {
  await assertDiscoverQueryOwned(userId, queryId);
  if (projectId) await assertProjectOwned(userId, projectId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.discoverQuery.update({
      where: { id: queryId },
      data: { projectId },
    });
    let movedReviewIds: string[] = [];
    if (projectId) {
      const reviews = await tx.review.findMany({
        where: {
          userId,
          projectId: null,
          fromRecommendation: { queryId },
        },
        select: { id: true },
      });
      movedReviewIds = reviews.map((r) => r.id);
      if (movedReviewIds.length > 0) {
        await tx.review.updateMany({
          where: { id: { in: movedReviewIds } },
          data: { projectId },
        });
      }
    }
    return { query: rowToDiscoverQuery(row), movedReviewIds };
  });
}

export async function deleteDiscoverQuery(
  userId: string,
  queryId: string,
): Promise<void> {
  await assertDiscoverQueryOwned(userId, queryId);
  // Cascade on Recommendation handles its rows. fromRecommendationId on
  // any Reviews already pointing at recs in this query becomes null
  // automatically (SetNull), preserving the reviews.
  await prisma.discoverQuery.delete({ where: { id: queryId } });
}

/**
 * Open a recommendation: get-or-create the matching Review and link the
 * rec to it via fromRecommendationId on newly created reviews. Re-surfaces
 * (rec for a paper the user already has) just return the existing review
 * without overwriting the original origin.
 */
export async function openRecommendation(
  userId: string,
  recId: string,
): Promise<{ review: PaperReview; alreadyInLibrary: boolean }> {
  const rec = await getRecommendation(userId, recId);
  if (!rec) throw new HttpError(404, `Recommendation not found: ${recId}`);

  // Research that belongs to a project files what it opens into that
  // project, so reading from a project brief needs no manual linking.
  const query = await prisma.discoverQuery.findFirst({
    where: { id: rec.queryId, userId },
    select: { projectId: true },
  });
  const projectId = query?.projectId ?? null;

  const canonicalArxivId = rec.arxivId ? normalizeArxivId(rec.arxivId) : null;
  const existing = canonicalArxivId
    ? await getReviewByArxivId(userId, canonicalArxivId)
    : await getReviewBySourceUrl(userId, rec.url);
  if (existing) {
    // An ungrouped paper joins the project; one already filed elsewhere
    // stays where the user put it.
    if (projectId && !existing.projectId) {
      const moved = await assignReviewToProject(userId, existing.id, projectId);
      return { review: moved, alreadyInLibrary: true };
    }
    return { review: existing, alreadyInLibrary: true };
  }

  const now = new Date().toISOString();
  const fallbackTitle = canonicalArxivId ? `arXiv:${canonicalArxivId}` : rec.url;
  const review = await insertReview(
    userId,
    {
      id: crypto.randomUUID(),
      title: rec.title || fallbackTitle,
      arxivId: canonicalArxivId,
      createdAt: now,
      updatedAt: now,
      pdfPath: null,
      sourceUrl: canonicalArxivId ? null : rec.url,
    },
    recId,
    projectId,
  );
  return { review, alreadyInLibrary: false };
}

/* ── Projects ─────────────────────────────────────────────────── */

function rowToProject(r: {
  id: string;
  name: string;
  createdAt: Date;
}): Project {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listProjects(userId: string): Promise<Project[]> {
  const rows = await prisma.project.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToProject);
}

export async function createProject(
  userId: string,
  data: { name: string },
): Promise<Project> {
  const row = await prisma.project.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      name: data.name,
    },
  });
  return rowToProject(row);
}

export async function updateProject(
  userId: string,
  id: string,
  patch: { name?: string },
): Promise<Project> {
  const existing = await prisma.project.findFirst({ where: { id, userId } });
  if (!existing) throw new HttpError(404, `Project not found: ${id}`);
  const row = await prisma.project.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
    },
  });
  return rowToProject(row);
}

export async function deleteProject(userId: string, id: string): Promise<void> {
  const existing = await prisma.project.findFirst({ where: { id, userId } });
  if (!existing) throw new HttpError(404, `Project not found: ${id}`);
  // SetNull on Review.projectId is handled by the DB constraint — papers survive.
  await prisma.project.delete({ where: { id } });
}

export async function assignReviewToProject(
  userId: string,
  reviewId: string,
  projectId: string | null,
): Promise<PaperReview> {
  const review = await prisma.review.findFirst({ where: { id: reviewId, userId } });
  if (!review) throw new HttpError(404, `Review not found: ${reviewId}`);
  if (projectId !== null) {
    const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
    if (!project) throw new HttpError(404, `Project not found: ${projectId}`);
  }
  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: { projectId },
  });
  return rowToReview(updated);
}
