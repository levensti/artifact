/**
 * Browser-side client for content-addressed documents.
 *
 * On paper open the viewer extracts the text (+ PDF outline); we hash it,
 * register it with the server (which stores it once per hash and indexes
 * long documents), and poll until the index is ready. Chat turns then send
 * only the hash — the server owns the text.
 */

import { apiFetch } from "@/lib/client/api";
import type { DocumentOutlineEntry, DocumentStatus } from "@/lib/documents";
import type { PageMap } from "@/lib/review-types";

export type { DocumentStatus };

/** sha256 of extracted text, hex-encoded — the document's identity. */
export async function hashPaperText(paperText: string): Promise<string> {
  const data = new TextEncoder().encode(paperText);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function registerDocument(
  text: string,
  opts: {
    title?: string | null;
    outline?: DocumentOutlineEntry[] | null;
    reviewId?: string;
    apiKey?: string;
  } = {},
): Promise<DocumentStatus> {
  const hash = await hashPaperText(text);
  return apiFetch<DocumentStatus>("/api/documents", {
    method: "POST",
    body: {
      hash,
      text,
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.outline?.length ? { outline: opts.outline } : {}),
      ...(opts.reviewId ? { reviewId: opts.reviewId } : {}),
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    },
  });
}

export async function getDocumentStatus(hash: string): Promise<DocumentStatus | null> {
  try {
    return await apiFetch<DocumentStatus>(`/api/documents/${encodeURIComponent(hash)}`);
  } catch {
    return null;
  }
}

/**
 * True once chat can run for this document: the server holds the text. A
 * long document that is still indexing is NOT a reason to wait — the server
 * answers from the leading slice until the index lands, and the chat header
 * shows indexing progress instead of blocking the composer.
 */
export function isDocumentReady(status: DocumentStatus | null): boolean {
  return !!status && status.hasText;
}

/** Whether the index is still to come (queued or building): keep polling,
 *  and keep chat locked, since chat reads the document only via retrieval. */
export function isDocumentIndexing(status: DocumentStatus | null): boolean {
  return (
    !!status && (status.indexStatus === "indexing" || status.indexStatus === "pending")
  );
}

export interface CitableSection {
  label: string;
  title: string;
  startPage: number | null;
}

export async function getDocumentSections(hash: string): Promise<CitableSection[]> {
  try {
    const { sections } = await apiFetch<{ sections: CitableSection[] }>(
      `/api/documents/${encodeURIComponent(hash)}/sections`,
    );
    return sections;
  } catch {
    return [];
  }
}

/**
 * Shape the server's section tree like an LLM page map so the existing
 * citation resolver can take "§3.1.4" to a page and scroll to its heading.
 * Figures and tables stay empty: those still come from the real page map
 * or the structured parse when available.
 */
export function sectionsToPageMap(sections: CitableSection[]): PageMap | null {
  const pages: Record<string, number> = {};
  const anchors: Record<string, string> = {};
  for (const s of sections) {
    if (s.startPage) pages[s.label] = s.startPage;
    anchors[s.label] = s.title;
  }
  if (Object.keys(pages).length === 0) return null;
  return {
    sections: pages,
    figures: {},
    tables: {},
    anchors: { sections: anchors, figures: {}, tables: {} },
  };
}

export interface ReviewDocument {
  status: DocumentStatus;
  text: string;
  sections: CitableSection[];
}

/**
 * The stored document for a review, or null when the review has no linked
 * document yet (first open of a new upload). Used to skip browser-side text
 * extraction on reopen.
 */
export async function getReviewDocument(reviewId: string): Promise<ReviewDocument | null> {
  try {
    return await apiFetch<ReviewDocument>(
      `/api/reviews/${encodeURIComponent(reviewId)}/document`,
    );
  } catch {
    return null;
  }
}
