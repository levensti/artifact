import "server-only";

/**
 * Retrieval for long documents on the chat path:
 *
 *   rewrite the question → embed → top-k by cosine with a floor → pull one
 *   neighbor chunk each side → order by document position → format with
 *   section + page provenance → cap to a token budget.
 *
 * Top-k with a loose floor rather than a bare threshold: cosine scores are
 * not calibrated across documents, so a fixed cutoff returns forty chunks
 * for one question and none for the next.
 */

import { FIREWORKS_BASE_URL, getFireworksModel } from "@/lib/fireworks";
import { approxTokens } from "./indexing/text";
import { embedTexts, type EmbedUsage } from "./embeddings";
import * as docs from "./documents";
import { formatPages, type ChunkHit } from "@/lib/documents";
import type { TranscriptMessage } from "@/lib/transcript";

const TOP_K = 10;
const SCORE_FLOOR = 0.25;
const NEIGHBORS = 1;
const MAX_CONTEXT_TOKENS = 12_000;
/** Prior turns fed to the query rewriter. */
const REWRITE_HISTORY_TURNS = 4;
const REWRITE_TIMEOUT_MS = 15_000;

export interface RetrievalResult {
  /** Ready-to-inject passages, or null when nothing cleared the floor. */
  block: string | null;
  hits: ChunkHit[];
  /** The query actually embedded (after rewriting). */
  query: string;
  embedUsage: EmbedUsage;
  /** Tokens spent on the rewrite call (prompt + completion). */
  rewriteTokens: number;
}

export async function retrieveContext(params: {
  documentId: string;
  apiKey: string;
  conversation: TranscriptMessage[];
}): Promise<RetrievalResult> {
  const { documentId, apiKey, conversation } = params;
  const lastUser = [...conversation].reverse().find((m) => m.role === "user");
  const raw = lastUser?.content?.trim() ?? "";
  if (!raw) {
    return { block: null, hits: [], query: "", embedUsage: { tokens: 0, requests: 0 }, rewriteTokens: 0 };
  }

  const t0 = Date.now();
  const { query, tokens: rewriteTokens } = await rewriteQuery(apiKey, conversation, raw);
  const t1 = Date.now();

  let embedUsage: EmbedUsage = { tokens: 0, requests: 0 };
  const [vector] = await embedTexts(apiKey, [query], (u) => {
    embedUsage = u;
  });
  const t2 = Date.now();

  const top = (await docs.searchChunks(documentId, vector, TOP_K)).filter(
    (h) => (h.score ?? 0) >= SCORE_FLOOR,
  );
  console.log(
    `Retrieval for document ${documentId}: rewrite ${t1 - t0}ms` +
      `${query === raw ? " (skipped)" : ""}, embed ${t2 - t1}ms, search ${Date.now() - t2}ms, ` +
      `${top.length} hits above floor`,
  );
  if (top.length === 0) {
    return { block: null, hits: [], query, embedUsage, rewriteTokens };
  }

  // Neighbor expansion, then merge back into document order.
  const wanted = new Set<number>();
  for (const h of top) {
    for (let d = -NEIGHBORS; d <= NEIGHBORS; d++) {
      if (h.ordinal + d >= 0) wanted.add(h.ordinal + d);
    }
  }
  const byOrdinal = new Map<number, ChunkHit>(top.map((h) => [h.ordinal, h]));
  const missing = [...wanted].filter((o) => !byOrdinal.has(o));
  for (const n of await docs.getChunksByOrdinal(documentId, missing)) {
    byOrdinal.set(n.ordinal, n);
  }
  let hits = [...byOrdinal.values()].sort((a, b) => a.ordinal - b.ordinal);

  // Budget: drop the lowest-scoring hit (and its orphaned neighbors) until
  // the block fits. Neighbors have no score, so they go first.
  while (hits.length > 1 && totalTokens(hits) > MAX_CONTEXT_TOKENS) {
    const victim = hits.reduce((worst, h) =>
      (h.score ?? -1) < (worst.score ?? -1) ? h : worst,
    );
    hits = hits.filter((h) => h !== victim);
  }

  return { block: formatRetrievedBlock(hits), hits, query, embedUsage, rewriteTokens };
}

function totalTokens(hits: ChunkHit[]): number {
  return hits.reduce((n, h) => n + approxTokens(h.text), 0);
}

/**
 * Render hits as passages grouped by section, each with its page range, so
 * the model reads coherent text and can cite pages the UI resolves.
 */
export function formatRetrievedBlock(hits: ChunkHit[]): string {
  const parts: string[] = [];
  let currentSection: string | null | undefined = undefined;
  let prevOrdinal = -2;
  for (const h of hits) {
    const sectionKey = h.sectionLabel
      ? `§${h.sectionLabel} ${h.sectionTitle ?? ""}`.trim()
      : h.sectionTitle;
    if (sectionKey !== currentSection) {
      currentSection = sectionKey;
      parts.push(`\n## ${sectionKey ?? "(unsectioned)"}`);
    } else if (h.ordinal !== prevOrdinal + 1) {
      parts.push("\n[…]");
    }
    const pages = formatPages(h.startPage, h.endPage);
    parts.push(`${pages ? `(${pages}) ` : ""}${h.text}`);
    prevOrdinal = h.ordinal;
  }
  return parts.join("\n").trim();
}

/* ------------------------------------------------------------------ */
/*  Query rewriting                                                    */
/* ------------------------------------------------------------------ */

const REWRITE_SYSTEM = `You rewrite the latest user message in a conversation about a document into a standalone search query for retrieving the relevant passages. Resolve pronouns and references ("that", "the second one", "this method") using the earlier turns. Keep the user's key terms. Output ONLY the rewritten query, one line, no quotes, no commentary. If the message is already self-contained, output it unchanged.`;

/**
 * Turn a follow-up ("why does that work?") into a standalone query using
 * the preceding turns. Skipped only when there is no history (nothing to
 * resolve against). Hidden reasoning is disabled for the
 * call: it is a one-line rewrite, and a thinking model spends several
 * seconds deliberating otherwise. Any failure falls back to the raw message —
 * retrieval must never block on the rewriter.
 */
async function rewriteQuery(
  apiKey: string,
  conversation: TranscriptMessage[],
  raw: string,
): Promise<{ query: string; tokens: number }> {
  const prior = conversation
    .filter((m) => m.content?.trim())
    .slice(0, -1)
    .slice(-REWRITE_HISTORY_TURNS);
  if (prior.length === 0) return { query: raw, tokens: 0 };

  const transcript = prior
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 1500)}`)
    .join("\n\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REWRITE_TIMEOUT_MS);
  try {
    const response = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: getFireworksModel(),
        messages: [
          { role: "system", content: REWRITE_SYSTEM },
          { role: "user", content: `Conversation so far:\n\n${transcript}\n\nLatest user message:\n${raw}` },
        ],
        max_tokens: 200,
        temperature: 0,
        stream: false,
        // Fireworks' switch for hidden reasoning on thinking models.
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { query: raw, tokens: 0 };
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim().split("\n")[0]?.trim();
    const tokens = data.usage?.total_tokens ?? 0;
    if (!text || text.length > 600) return { query: raw, tokens };
    return { query: text, tokens };
  } catch {
    return { query: raw, tokens: 0 };
  } finally {
    clearTimeout(timer);
  }
}
