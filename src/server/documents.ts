import "server-only";

/**
 * Persistence for content-addressed documents, their section tree, and their
 * chunk embeddings. Everything touching the `halfvec` column goes through raw
 * SQL because Prisma can't type pgvector; the rest is ordinary Prisma.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { PageMap } from "@/lib/review-types";
import {
  documentMode,
  type ChunkHit,
  type DocumentOutlineEntry,
  type DocumentStatus,
} from "@/lib/documents";
import { EMBEDDING_DIMS, EMBEDDING_MODEL, toVectorLiteral } from "./embeddings";
import { detectSections } from "./indexing/sections";
import type { Chunk } from "./indexing/chunker";

/* ── Documents ────────────────────────────────────────────────── */

/** Outline → JSON column value (Prisma needs the explicit null for "unset"). */
function toJson(outline: DocumentOutlineEntry[] | null | undefined) {
  return outline && outline.length > 0
    ? (outline as unknown as Prisma.InputJsonValue)
    : Prisma.JsonNull;
}

type DocumentRow = Prisma.DocumentGetPayload<object>;

export function toStatus(doc: DocumentRow): DocumentStatus {
  return {
    id: doc.id,
    hash: doc.hash,
    mode: documentMode(doc.charCount),
    charCount: doc.charCount,
    hasText: doc.text !== null,
    hasPageMap: doc.pageMap !== null,
    title: doc.title,
    indexStatus: doc.indexStatus,
    indexError: doc.indexError,
    indexProgress: doc.indexProgress,
    chunkCount: doc.chunkCount,
  };
}

export async function getDocumentByHash(hash: string): Promise<DocumentRow | null> {
  return prisma.document.findUnique({ where: { hash } });
}

export async function getDocumentById(id: string): Promise<DocumentRow | null> {
  return prisma.document.findUnique({ where: { id } });
}

/**
 * Create the document for `hash` or fill in its text if a legacy backfilled
 * row has none. The section tree is (re)built from the outline whenever the
 * text is (re)written, since it is cheap and deterministic. Returns the row
 * and whether the text was newly stored (which is what triggers indexing).
 */
export async function registerDocument(params: {
  hash: string;
  text: string;
  title?: string | null;
  outline?: DocumentOutlineEntry[] | null;
}): Promise<{ doc: DocumentRow; textStored: boolean }> {
  const { hash, text, title, outline } = params;
  const existing = await prisma.document.findUnique({ where: { hash } });
  if (existing && existing.text !== null) {
    let doc = existing;
    if (!existing.title && title) {
      doc = await prisma.document.update({ where: { id: existing.id }, data: { title } });
    }
    // Rebuild the section tree when detection has improved since this
    // document was registered (an outline arrived for a document that has
    // none stored, or its sections carry no labels). Chunks are re-pointed
    // at the new sections in place, so no re-embedding is needed.
    const stale =
      (outline && outline.length > 0 && !existing.outline) ||
      (await prisma.documentSection.count({
        where: { documentId: existing.id, label: { not: null } },
      })) === 0;
    if (stale) {
      doc = await prisma.document.update({
        where: { id: existing.id },
        data: { outline: outline?.length ? toJson(outline) : undefined },
      });
      await replaceSections(
        existing.id,
        existing.text,
        (outline ?? (existing.outline as unknown as DocumentOutlineEntry[] | null)) ?? null,
      );
    }
    return { doc, textStored: false };
  }

  const doc = existing
    ? await prisma.document.update({
        where: { id: existing.id },
        data: {
          text,
          charCount: text.length,
          title: existing.title ?? title ?? null,
          outline: toJson(outline),
          indexStatus: "pending",
          indexError: null,
        },
      })
    : await prisma.document
        .create({
          data: {
            hash,
            text,
            charCount: text.length,
            title: title ?? null,
            outline: toJson(outline),
          },
        })
        .catch((err: unknown) => {
          // Another reader registered the same paper between our lookup and
          // this insert. Theirs holds the same text, so use it.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            return null;
          }
          throw err;
        });
  if (!doc) return registerDocument(params);

  await replaceSections(doc.id, text, outline ?? null);
  return { doc, textStored: true };
}

/** Prisma's 5s default is too tight for re-pointing a large document's
 *  chunks at its sections. */
const SECTIONS_TX_TIMEOUT_MS = 30_000;

export async function replaceSections(
  documentId: string,
  text: string,
  outline: DocumentOutlineEntry[] | null,
): Promise<void> {
  const detected = detectSections(text, outline);
  await prisma.$transaction(async (tx) => {
    await tx.documentSection.deleteMany({ where: { documentId } });
    if (detected.length === 0) {
      await tx.documentChunk.updateMany({ where: { documentId }, data: { sectionId: null } });
      return;
    }
    // One bulk insert rather than a round trip per section: a bookmarked
    // textbook can have hundreds of sections, and per-row inserts blew the
    // transaction timeout. Ids are minted up front so parentId can point at
    // rows in the same batch; detectSections emits parent-first, so any
    // batch split Prisma makes still inserts parents before children.
    const ids = detected.map(() => crypto.randomUUID());
    await tx.documentSection.createMany({
      data: detected.map((s, i) => ({
        id: ids[i],
        documentId,
        parentId: s.parentIndex === null ? null : ids[s.parentIndex],
        ordinal: s.ordinal,
        depth: s.depth,
        label: s.label,
        title: s.title,
        startPage: s.startPage,
        endPage: s.endPage,
        charStart: s.charStart,
        charEnd: s.charEnd,
      })),
    });
    // Point existing chunks at the deepest section containing their start.
    await tx.$executeRaw`
      UPDATE "DocumentChunk" c
      SET "sectionId" = s."id"
      FROM (
        SELECT DISTINCT ON (c2."id") c2."id" AS "chunkId", s2."id"
        FROM "DocumentChunk" c2
        JOIN "DocumentSection" s2
          ON s2."documentId" = c2."documentId"
         AND c2."charStart" >= s2."charStart"
         AND c2."charStart" <  s2."charEnd"
        WHERE c2."documentId" = ${documentId}
        ORDER BY c2."id", s2."depth" DESC
      ) s
      WHERE c."id" = s."chunkId"
    `;
    await tx.$executeRaw`
      UPDATE "DocumentChunk" c SET "sectionId" = NULL
      WHERE c."documentId" = ${documentId}
        AND NOT EXISTS (
          SELECT 1 FROM "DocumentSection" s
          WHERE s."documentId" = c."documentId"
            AND c."charStart" >= s."charStart" AND c."charStart" < s."charEnd"
        )
    `;
  }, { timeout: SECTIONS_TX_TIMEOUT_MS });
}

/**
 * Table of contents for the prompt: one heading per line, indented by depth,
 * with its label and start page. Empty string when no sections were found.
 */
export async function tableOfContents(documentId: string): Promise<string> {
  const rows = await prisma.documentSection.findMany({
    where: { documentId },
    orderBy: { charStart: "asc" },
    select: { label: true, title: true, depth: true, startPage: true },
  });
  return rows
    .map(
      (r) =>
        `${"  ".repeat(r.depth)}${r.label ? `§${r.label} ` : ""}${r.title}` +
        (r.startPage ? ` (p. ${r.startPage})` : ""),
    )
    .join("\n");
}

/** Labeled sections for client-side citation resolution (§label → page). */
export async function listCitableSections(
  hash: string,
): Promise<Array<{ label: string; title: string; startPage: number | null }>> {
  const doc = await prisma.document.findUnique({ where: { hash }, select: { id: true } });
  if (!doc) return [];
  const rows = await prisma.documentSection.findMany({
    where: { documentId: doc.id, label: { not: null } },
    orderBy: { charStart: "asc" },
    select: { label: true, title: true, startPage: true },
  });
  return rows.map((r) => ({ label: r.label!, title: r.title, startPage: r.startPage }));
}

export async function listSections(documentId: string) {
  return prisma.documentSection.findMany({
    where: { documentId },
    orderBy: { charStart: "asc" },
  });
}

/** Link a review (which the caller has verified the user owns) to a document. */
export async function linkReviewDocument(
  userId: string,
  reviewId: string,
  documentId: string,
): Promise<void> {
  await prisma.review.updateMany({
    where: { id: reviewId, userId },
    data: { documentId },
  });
}

/* ── Parse + page-map caches (content-derived, shared) ────────── */

export async function getPageMap(hash: string): Promise<PageMap | null> {
  const row = await prisma.document.findUnique({ where: { hash }, select: { pageMap: true } });
  return row?.pageMap ? (row.pageMap as unknown as PageMap) : null;
}

export async function setPageMap(hash: string, map: PageMap): Promise<void> {
  const data = {
    pageMap: map as unknown as Prisma.InputJsonValue,
    ...(map.title?.trim() ? { title: map.title.trim() } : {}),
  };
  await prisma.document.upsert({
    where: { hash },
    create: { hash, ...data },
    update: { pageMap: data.pageMap },
  });
}

/* ── Index lifecycle ──────────────────────────────────────────── */

/** A worker that started this long ago without finishing is presumed dead. */
const STALE_INDEXING_MS = 10 * 60 * 1000;

/**
 * Whether `claimForIndexing` would accept this row: never indexed, failed,
 * wedged in `indexing` past the stale window, or indexed with a different
 * embedding model / width than the current one.
 */
export function needsIndexing(doc: DocumentRow): boolean {
  if (doc.text === null) return false;
  switch (doc.indexStatus) {
    case "pending":
    case "failed":
      return true;
    case "indexing":
      return (
        !doc.indexStartedAt ||
        doc.indexStartedAt.getTime() < Date.now() - STALE_INDEXING_MS
      );
    case "ready":
      return doc.embeddingModel !== EMBEDDING_MODEL || doc.embeddingDims !== EMBEDDING_DIMS;
  }
}

/**
 * Atomically claim a document for indexing. Returns false when another
 * worker holds a live claim or the document is already indexed with the
 * current model, so two readers opening a new paper at once don't both pay.
 */
export async function claimForIndexing(documentId: string): Promise<boolean> {
  const stale = new Date(Date.now() - STALE_INDEXING_MS);
  const result = await prisma.document.updateMany({
    where: {
      id: documentId,
      text: { not: null },
      OR: [
        { indexStatus: "pending" },
        { indexStatus: "failed" },
        { indexStatus: "indexing", indexStartedAt: { lt: stale } },
        { indexStatus: "ready", embeddingModel: { not: EMBEDDING_MODEL } },
        { indexStatus: "ready", embeddingDims: { not: EMBEDDING_DIMS } },
      ],
    },
    data: {
      indexStatus: "indexing",
      indexStartedAt: new Date(),
      indexError: null,
      indexProgress: 0,
    },
  });
  return result.count === 1;
}

/** Best-effort progress write; a failure here must not fail indexing. */
export async function setIndexProgress(documentId: string, percent: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  await prisma.document
    .updateMany({ where: { id: documentId, indexStatus: "indexing" }, data: { indexProgress: clamped } })
    .catch(() => {});
}

export async function markIndexed(documentId: string, chunkCount: number): Promise<void> {
  await prisma.document.update({
    where: { id: documentId },
    data: {
      indexStatus: "ready",
      indexError: null,
      indexProgress: 100,
      chunkCount,
      embeddingModel: EMBEDDING_MODEL,
      embeddingDims: EMBEDDING_DIMS,
    },
  });
}

export async function markIndexFailed(documentId: string, error: string): Promise<void> {
  await prisma.document.update({
    where: { id: documentId },
    data: { indexStatus: "failed", indexError: error.slice(0, 1000) },
  });
}

/* ── Chunks (raw SQL for the halfvec column) ──────────────────── */

export interface ChunkInsert extends Chunk {
  ordinal: number;
  sectionId: string | null;
  startPage: number | null;
  endPage: number | null;
  embedding: number[];
}

const INSERT_BATCH = 50;

export async function replaceChunks(documentId: string, chunks: ChunkInsert[]): Promise<void> {
  await prisma.documentChunk.deleteMany({ where: { documentId } });
  for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
    const batch = chunks.slice(i, i + INSERT_BATCH);
    const rows = batch.map(
      (c) =>
        Prisma.sql`(${crypto.randomUUID()}, ${documentId}, ${c.sectionId}, ${c.ordinal}, ${c.text}, ${c.tokenCount}, ${c.startPage}, ${c.endPage}, ${c.charStart}, ${c.charEnd}, ${toVectorLiteral(c.embedding)}::halfvec)`,
    );
    await prisma.$executeRaw`
      INSERT INTO "DocumentChunk"
        ("id", "documentId", "sectionId", "ordinal", "text", "tokenCount", "startPage", "endPage", "charStart", "charEnd", "embedding")
      VALUES ${Prisma.join(rows)}
    `;
  }
}

interface ChunkRow {
  ordinal: number;
  text: string;
  startPage: number | null;
  endPage: number | null;
  sectionTitle: string | null;
  sectionLabel: string | null;
  score?: number;
}

/** Top-k chunks of one document by cosine similarity to `queryVector`. */
export async function searchChunks(
  documentId: string,
  queryVector: number[],
  k: number,
): Promise<ChunkHit[]> {
  const literal = toVectorLiteral(queryVector);
  const rows = await prisma.$queryRaw<ChunkRow[]>`
    SELECT c."ordinal", c."text", c."startPage", c."endPage",
           s."title" AS "sectionTitle", s."label" AS "sectionLabel",
           1 - (c."embedding" <=> ${literal}::halfvec) AS "score"
    FROM "DocumentChunk" c
    LEFT JOIN "DocumentSection" s ON s."id" = c."sectionId"
    WHERE c."documentId" = ${documentId} AND c."embedding" IS NOT NULL
    ORDER BY c."embedding" <=> ${literal}::halfvec
    LIMIT ${k}
  `;
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

/** Chunks by ordinal (document order), for neighbor expansion. */
export async function getChunksByOrdinal(
  documentId: string,
  ordinals: number[],
): Promise<ChunkHit[]> {
  if (ordinals.length === 0) return [];
  const rows = await prisma.$queryRaw<ChunkRow[]>`
    SELECT c."ordinal", c."text", c."startPage", c."endPage",
           s."title" AS "sectionTitle", s."label" AS "sectionLabel"
    FROM "DocumentChunk" c
    LEFT JOIN "DocumentSection" s ON s."id" = c."sectionId"
    WHERE c."documentId" = ${documentId} AND c."ordinal" IN (${Prisma.join(ordinals)})
    ORDER BY c."ordinal"
  `;
  return rows;
}
