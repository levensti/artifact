import "server-only";

/**
 * Indexing orchestrator: text → sections → semantic chunks → embeddings →
 * rows. Runs after the registration response (`after()` in the route) so the
 * upload returns immediately and the client polls `indexStatus`.
 *
 * Two embedding passes, both through the shared limiter: sentence windows to
 * find boundaries, then the final chunks for storage. At ~$0.10 per million
 * tokens that is a few cents per textbook, so the double pass is not worth
 * engineering around.
 */

import { embedTexts, type EmbedUsage } from "../embeddings";
import * as docs from "../documents";
import { planChunks } from "./chunker";
import { leafRanges } from "./sections";
import { pageAt, pageAtEnd, parsePageMarkers } from "./text";

export interface IndexDocumentParams {
  documentId: string;
  apiKey: string;
  /** Receives the summed embedding usage for metering. */
  onUsage?: (usage: EmbedUsage) => void;
}

export async function indexDocument(params: IndexDocumentParams): Promise<void> {
  const { documentId, apiKey } = params;
  const claimed = await docs.claimForIndexing(documentId);
  if (!claimed) {
    console.log(`Indexing skipped for document ${documentId}: already claimed or up to date`);
    return;
  }
  console.log(`Indexing started for document ${documentId}`);

  const usage: EmbedUsage = { tokens: 0, requests: 0 };
  const addUsage = (u: EmbedUsage) => {
    usage.tokens += u.tokens;
    usage.requests += u.requests;
  };
  // Progress: pass 1 (boundary windows) is the bulk of the work and maps to
  // 0–85%, pass 2 (chunk vectors) to 85–97%, the row writes to 100%. Writes
  // are throttled to whole steps of 5 so a textbook doesn't spam the DB.
  let lastWritten = -1;
  const report = (percent: number) => {
    const step = Math.floor(percent / 5) * 5;
    if (step <= lastWritten) return;
    lastWritten = step;
    void docs.setIndexProgress(documentId, step);
  };
  const embed = (texts: string[], from = 0, to = 100) =>
    embedTexts(apiKey, texts, addUsage, (done, total) =>
      report(from + ((to - from) * done) / Math.max(1, total)),
    );

  const startedAt = Date.now();
  try {
    const doc = await docs.getDocumentById(documentId);
    if (!doc?.text) throw new Error("Document has no text to index");
    const text = doc.text;
    const markers = parsePageMarkers(text);

    const sections = await docs.listSections(documentId);
    const detected = sections.map((s) => ({
      title: s.title,
      label: s.label,
      depth: s.depth,
      parentIndex: s.parentId ? sections.findIndex((p) => p.id === s.parentId) : null,
      ordinal: s.ordinal,
      charStart: s.charStart,
      charEnd: s.charEnd,
      startPage: s.startPage,
      endPage: s.endPage,
    }));

    // Pass 1: boundaries. Chunking is per section (a chunk never spans two
    // sections) but the embedding is one batched call over every section's
    // sentence windows, so a textbook with hundreds of short sections costs
    // ~100 batched requests rather than one round trip per section.
    const ranges = leafRanges(text, detected);
    const plans = ranges.map((r) => planChunks(text, r.charStart, r.charEnd));
    const allWindows = plans.flatMap((p) => p.windows);
    const allVectors = await embed(allWindows, 0, 85);
    const pending: docs.ChunkInsert[] = [];
    let cursor = 0;
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      const n = plans[i].windows.length;
      const chunks = plans[i].finalize(allVectors.slice(cursor, cursor + n));
      cursor += n;
      for (const c of chunks) {
        pending.push({
          ...c,
          ordinal: pending.length,
          sectionId: range.sectionIndex === null ? null : sections[range.sectionIndex].id,
          startPage: pageAt(markers, c.charStart),
          endPage: pageAtEnd(text, markers, c.charStart, c.charEnd),
          embedding: [],
        });
      }
    }

    // Pass 2: the vectors we actually store.
    const vectors = await embed(pending.map((c) => c.text), 85, 97);
    vectors.forEach((v, i) => {
      pending[i].embedding = v;
    });

    await docs.replaceChunks(documentId, pending);
    await docs.markIndexed(documentId, pending.length);
    console.log(
      `Indexed document ${documentId}: ${doc.charCount.toLocaleString()} chars, ` +
        `${ranges.length} ranges, ${allWindows.length} windows, ${pending.length} chunks, ` +
        `${usage.requests} embedding requests, ${usage.tokens.toLocaleString()} tokens, ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Indexing failed for document ${documentId}:`, err);
    await docs.markIndexFailed(documentId, message).catch(() => {});
  } finally {
    params.onUsage?.(usage);
  }
}
