import "server-only";
import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import type { Annotation } from "@/lib/annotations";
import type { DeepDiveSession } from "@/lib/deep-dives";
import type { PrerequisitesData } from "@/lib/explore";
import type { ChatMessage, PaperReview } from "@/lib/review-types";
import type { WikiPage, WikiPageType } from "@/lib/wiki";
import { extractWikiLinkSlugs } from "@/lib/wiki-link-transform";
import { normalizeArxivId } from "@/lib/arxiv";
import { HttpError } from "./api";

/* ── Reviews ──────────────────────────────────────────────────── */

export async function listReviews(userId: string): Promise<PaperReview[]> {
  const rows = await prisma.review.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
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
    },
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
}): PaperReview {
  return {
    id: r.id,
    title: r.title,
    arxivId: r.arxivId,
    pdfPath: r.pdfPath,
    sourceUrl: r.sourceUrl,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    ...(r.importedAt ? { importedAt: r.importedAt.toISOString() } : {}),
  };
}

/* ── Messages / annotations / prerequisites ───────────────────── */

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

export async function setMessages(
  userId: string,
  reviewId: string,
  messages: ChatMessage[],
): Promise<void> {
  await assertReviewOwned(userId, reviewId);
  await prisma.reviewMessages.upsert({
    where: { reviewId },
    create: { reviewId, messages: messages as unknown as Prisma.InputJsonValue },
    update: { messages: messages as unknown as Prisma.InputJsonValue },
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
  await assertReviewOwned(userId, reviewId);
  await prisma.reviewAnnotations.upsert({
    where: { reviewId },
    create: {
      reviewId,
      annotations: annotations as unknown as Prisma.InputJsonValue,
    },
    update: {
      annotations: annotations as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function getPrerequisites(
  userId: string,
  reviewId: string,
): Promise<PrerequisitesData | null> {
  await assertReviewOwned(userId, reviewId);
  const row = await prisma.prerequisites.findUnique({ where: { reviewId } });
  return (row?.data as unknown as PrerequisitesData | undefined) ?? null;
}

export async function setPrerequisites(
  userId: string,
  reviewId: string,
  data: PrerequisitesData,
): Promise<void> {
  await assertReviewOwned(userId, reviewId);
  await prisma.prerequisites.upsert({
    where: { reviewId },
    create: { reviewId, data: data as unknown as Prisma.InputJsonValue },
    update: { data: data as unknown as Prisma.InputJsonValue },
  });
}

export async function clearPrerequisites(
  userId: string,
  reviewId: string,
): Promise<void> {
  await assertReviewOwned(userId, reviewId);
  await prisma.prerequisites.deleteMany({ where: { reviewId } });
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
  id: number;
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
    orderBy: { id: "desc" },
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
  id: number,
): Promise<{
  id: number;
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

import {
  isInferenceProviderType,
  type InferenceProviderProfile,
  type Model,
  type Provider,
} from "@/lib/models";
import { decrypt, encrypt } from "./crypto";

/** Pseudo-provider identifying the Brave Search tool key in the ApiKey table. */
const BRAVE_PROVIDER = "brave";

export interface SettingsSnapshot {
  keys: Partial<Record<Provider, string>>;
  inferenceProfiles: InferenceProviderProfile[];
  selectedModel: Model | null;
  braveSearchApiKey: string | null;
}

export async function getSettings(userId: string): Promise<SettingsSnapshot> {
  const [apiKeys, profiles, prefs] = await Promise.all([
    prisma.apiKey.findMany({ where: { userId } }),
    prisma.inferenceProfile.findMany({ where: { userId } }),
    prisma.userPreferences.findUnique({ where: { userId } }),
  ]);

  const keys: Partial<Record<Provider, string>> = {};
  let braveSearchApiKey: string | null = null;
  for (const row of apiKeys) {
    const value = decrypt(row.value);
    if (row.provider === BRAVE_PROVIDER) {
      braveSearchApiKey = value;
    } else {
      keys[row.provider as Provider] = value;
    }
  }

  const inferenceProfiles: InferenceProviderProfile[] = profiles.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind as InferenceProviderProfile["kind"],
    baseUrl: p.baseUrl,
    apiKey: decrypt(p.apiKey),
    supportsStreaming: p.supportsStreaming,
  }));

  let selectedModel = (prefs?.selectedModel as unknown as Model | null) ?? null;
  if (
    selectedModel &&
    isInferenceProviderType(selectedModel.provider) &&
    (!selectedModel.profileId ||
      !inferenceProfiles.some((p) => p.id === selectedModel!.profileId))
  ) {
    selectedModel = null;
  }

  return { keys, inferenceProfiles, selectedModel, braveSearchApiKey };
}

export interface SettingsPatch {
  keys?: Partial<Record<Provider, string | null>>;
  inferenceProfiles?: InferenceProviderProfile[] | null;
  selectedModel?: Model | null;
  braveSearchApiKey?: string | null;
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

    if (patch.keys) {
      for (const [provider, v] of Object.entries(patch.keys) as [
        Provider,
        string | null | undefined,
      ][]) {
        if (v === null || v === undefined || v === "") {
          await deleteKey(provider);
        } else {
          await upsertKey(provider, v);
        }
      }
    }

    if (patch.inferenceProfiles !== undefined && patch.inferenceProfiles !== null) {
      const next = patch.inferenceProfiles;
      const keepIds = next.map((p) => p.id);
      await tx.inferenceProfile.deleteMany({
        where: keepIds.length
          ? { userId, NOT: { id: { in: keepIds } } }
          : { userId },
      });
      for (const p of next) {
        const data = {
          label: p.label,
          kind: p.kind,
          baseUrl: p.baseUrl,
          apiKey: encrypt(p.apiKey),
          supportsStreaming: p.supportsStreaming !== false,
        };
        await tx.inferenceProfile.upsert({
          where: { id: p.id },
          create: { id: p.id, userId, ...data },
          update: data,
        });
      }
    }

    if ("selectedModel" in patch) {
      const value = patch.selectedModel
        ? (patch.selectedModel as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull;
      await tx.userPreferences.upsert({
        where: { userId },
        create: { userId, selectedModel: value },
        update: { selectedModel: value },
      });
    }

    if ("braveSearchApiKey" in patch) {
      const v = patch.braveSearchApiKey;
      if (v === null || v === undefined || v === "") {
        await deleteKey(BRAVE_PROVIDER);
      } else {
        await upsertKey(BRAVE_PROVIDER, v);
      }
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

/* ── Parsed papers (per-user content cache) ───────────────────── */

import type { ParsedPaper } from "@/lib/review-types";

export async function getCachedParsedPaper(
  userId: string,
  hash: string,
): Promise<ParsedPaper | null> {
  const row = await prisma.parsedPaper.findUnique({
    where: { userId_hash: { userId, hash } },
  });
  return row ? (row.parsed as unknown as ParsedPaper) : null;
}

export async function cacheParsedPaper(
  userId: string,
  hash: string,
  parsed: ParsedPaper,
): Promise<void> {
  await prisma.parsedPaper.upsert({
    where: { userId_hash: { userId, hash } },
    create: { userId, hash, parsed: parsed as unknown as Prisma.InputJsonValue },
    update: { parsed: parsed as unknown as Prisma.InputJsonValue },
  });
}
