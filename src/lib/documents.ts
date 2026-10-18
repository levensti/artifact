/**
 * Shared (client-safe) types and constants for content-addressed documents.
 *
 * A document is the extracted text of a paper or web page, identified by the
 * sha256 of that text. Every document is indexed into semantic chunks with
 * embeddings, and chat reads it only through retrieval: the client keeps chat
 * locked until the index is ready.
 */

/**
 * Normalize extracted text before it is hashed or stored. pdf.js emits NUL
 * (`\u0000`) for some glyphs and Postgres rejects it in `text` columns, so
 * it is dropped on both sides of the wire; the hash is always over the
 * normalized text.
 */
export function sanitizeExtractedText(text: string): string {
  return text.replace(/\u0000/g, "");
}

export type DocumentIndexStatus = "pending" | "indexing" | "ready" | "failed";

/** One entry of a PDF's outline (bookmarks), as extracted by pdf.js. */
export interface DocumentOutlineEntry {
  title: string;
  /** 1-based page the entry points at. */
  page: number;
  /** 0 = top level. */
  depth: number;
}

/** What `GET /api/documents/:hash` returns. */
export interface DocumentStatus {
  id: string;
  hash: string;
  charCount: number;
  /** False for rows backfilled from the legacy caches until text is uploaded. */
  hasText: boolean;
  hasPageMap: boolean;
  title: string | null;
  indexStatus: DocumentIndexStatus;
  indexError: string | null;
  /** 0–100 while indexing. */
  indexProgress: number;
  chunkCount: number;
}

/** A chunk returned by vector search — what tools and the prompt see. */
export interface ChunkHit {
  ordinal: number;
  text: string;
  startPage: number | null;
  endPage: number | null;
  sectionTitle: string | null;
  sectionLabel: string | null;
  /** Cosine similarity in [0, 1]; absent for neighbor-expanded chunks. */
  score?: number;
}

/** Format a page range for display: "p. 12" or "pp. 12–14". */
export function formatPages(
  startPage: number | null | undefined,
  endPage: number | null | undefined,
): string {
  if (!startPage) return "";
  if (!endPage || endPage === startPage) return `p. ${startPage}`;
  return `pp. ${startPage}–${endPage}`;
}
