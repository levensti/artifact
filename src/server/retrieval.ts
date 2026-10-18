import "server-only";

/**
 * Retrieval: how chat reads every document.
 *
 *   plan search queries from the user's intent → embed them → top-k per
 *   query by cosine with a floor → merge → pull one neighbor chunk each side
 *   → order by document position → format with section + page provenance →
 *   cap to a token budget.
 *
 * The planner is what makes broad requests work: "give me an overview" is a
 * poor single embedding (it matches the abstract), so the planner reads the
 * table of contents and turns intent into targeted queries, one per part of
 * the document the answer needs. A narrow question gets one or two.
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
import { extractJsonSubstring } from "@/lib/json-parse";

/** Hits for a single focused query. */
const TOP_K = 10;
/** Hits shared across queries when the planner splits a broad request;
 *  each query gets at least MIN_K_PER_QUERY. */
const MULTI_QUERY_TOTAL_K = 18;
const MIN_K_PER_QUERY = 4;
const SCORE_FLOOR = 0.25;
const NEIGHBORS = 1;
/** Passage budget for focused questions, and for broad multi-part ones. */
const MAX_CONTEXT_TOKENS = 12_000;
const MAX_BROAD_CONTEXT_TOKENS = 22_000;
/** Queries at or above this count are a broad request. */
const BROAD_QUERY_COUNT = 3;
const MAX_QUERIES = 6;
/** Prior turns fed to the planner. */
const PLAN_HISTORY_TURNS = 4;
const PLAN_TIMEOUT_MS = 15_000;
/** Table of contents shown to the planner; deeper levels are dropped first. */
const PLAN_TOC_MAX_CHARS = 6_000;

export interface RetrievalResult {
  /** Ready-to-inject passages, or null when nothing cleared the floor. */
  block: string | null;
  hits: ChunkHit[];
  /** The planned queries actually embedded. */
  queries: string[];
  embedUsage: EmbedUsage;
  /** Tokens spent on the planning call (prompt + completion). */
  planTokens: number;
}

export async function retrieveContext(params: {
  documentId: string;
  apiKey: string;
  conversation: TranscriptMessage[];
  /** The document's outline ("§1.2 Title (p. 8)" per line), for planning. */
  tableOfContents?: string;
}): Promise<RetrievalResult> {
  const { documentId, apiKey, conversation, tableOfContents } = params;
  const empty = (queries: string[], planTokens: number): RetrievalResult => ({
    block: null,
    hits: [],
    queries,
    embedUsage: { tokens: 0, requests: 0 },
    planTokens,
  });
  const lastUser = [...conversation].reverse().find((m) => m.role === "user");
  const raw = lastUser?.content?.trim() ?? "";
  if (!raw) return empty([], 0);

  const t0 = Date.now();
  const { queries, tokens: planTokens } = await planQueries(
    apiKey,
    conversation,
    raw,
    tableOfContents,
  );
  const t1 = Date.now();
  // The planner judged that the message needs nothing from the document
  // (thanks, a question about the conversation itself).
  if (queries.length === 0) return empty([], planTokens);

  let embedUsage: EmbedUsage = { tokens: 0, requests: 0 };
  const vectors = await embedTexts(apiKey, queries, (u) => {
    embedUsage = u;
  });
  const t2 = Date.now();

  // Search each query, then merge by chunk keeping the best score. Each
  // query's top hit is protected from the budget cut below so every part of
  // a broad request stays represented.
  const k =
    queries.length === 1
      ? TOP_K
      : Math.max(MIN_K_PER_QUERY, Math.ceil(MULTI_QUERY_TOTAL_K / queries.length));
  const perQuery = await Promise.all(
    vectors.map((v) => docs.searchChunks(documentId, v, k)),
  );
  const best = new Map<number, ChunkHit>();
  const protectedOrdinals = new Set<number>();
  for (const results of perQuery) {
    const kept = results.filter((h) => (h.score ?? 0) >= SCORE_FLOOR);
    if (kept[0]) protectedOrdinals.add(kept[0].ordinal);
    for (const h of kept) {
      const prev = best.get(h.ordinal);
      if (!prev || (h.score ?? 0) > (prev.score ?? 0)) best.set(h.ordinal, h);
    }
  }
  const top = [...best.values()];
  console.log(
    `Retrieval for document ${documentId}: plan ${t1 - t0}ms (${queries.length} ` +
      `${queries.length === 1 ? "query" : "queries"}), embed ${t2 - t1}ms, ` +
      `search ${Date.now() - t2}ms, ${top.length} hits above floor`,
  );
  if (top.length === 0) return { ...empty(queries, planTokens), embedUsage };

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
  // the block fits. Neighbors have no score, so they go first; each query's
  // top hit goes last.
  const budget =
    queries.length >= BROAD_QUERY_COUNT ? MAX_BROAD_CONTEXT_TOKENS : MAX_CONTEXT_TOKENS;
  const evictionScore = (h: ChunkHit) =>
    protectedOrdinals.has(h.ordinal) ? Infinity : (h.score ?? -1);
  while (hits.length > 1 && totalTokens(hits) > budget) {
    const victim = hits.reduce((worst, h) =>
      evictionScore(h) < evictionScore(worst) ? h : worst,
    );
    hits = hits.filter((h) => h !== victim);
  }

  return {
    block: formatRetrievedBlock(hits),
    hits,
    queries,
    embedUsage,
    planTokens,
  };
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
/*  Query planning                                                     */
/* ------------------------------------------------------------------ */

const PLAN_SYSTEM = `You plan searches over ONE document so an assistant can answer the user's latest message. You see the document's table of contents, the recent conversation, and the latest message. Each query you write is embedded and matched against passages of the document, so write each as a short description of the passage content you need, using the document's own vocabulary from the table of contents (e.g. "training objective and loss function", "ablation results on context length"), not as a question to the user.

Match the queries to what the user is actually asking for:
- A narrow question (one fact, term, result, or equation): 1 query. Add a second only if the answer clearly lives in two places.
- A broad request (an overview, summary, skim, critique, comparison, "explain the whole method", study material): one query per distinct part the answer needs, 3 to ${MAX_QUERIES}. For an overview, cover the problem and motivation, the core method, the main results, and the limitations, aimed at the sections that hold them.
- Resolve references to earlier turns ("that", "the second one", "this method") into the concrete thing.
- If the message needs nothing from the document (thanks, small talk, a question about the conversation itself), return no queries.

Respond with only a JSON object, no prose: {"queries": ["..."]}`;

/** The table of contents, trimmed for the planner: when it's too long,
 *  keep only the shallower levels. */
function tocForPlanner(toc: string | undefined): string | null {
  if (!toc?.trim()) return null;
  const lines = toc.split("\n");
  for (let maxDepth = 3; maxDepth >= 0; maxDepth--) {
    const kept = lines.filter((l) => (l.match(/^ */)?.[0].length ?? 0) / 2 <= maxDepth);
    const text = kept.join("\n");
    if (text.length <= PLAN_TOC_MAX_CHARS) return text;
  }
  return toc.slice(0, PLAN_TOC_MAX_CHARS);
}

/**
 * Turn the user's latest message into search queries that fit its intent,
 * using the table of contents to aim at the right sections and the recent
 * turns to resolve references. Runs on every turn (a first message can be
 * broad too). Hidden reasoning is disabled: a thinking model spends seconds
 * deliberating over what is a quick plan. Any failure falls back to the raw
 * message as the single query, since retrieval must never block on the
 * planner.
 */
async function planQueries(
  apiKey: string,
  conversation: TranscriptMessage[],
  raw: string,
  tableOfContents: string | undefined,
): Promise<{ queries: string[]; tokens: number }> {
  const fallback = { queries: [raw.slice(0, 600)], tokens: 0 };
  const prior = conversation
    .filter((m) => m.content?.trim())
    .slice(0, -1)
    .slice(-PLAN_HISTORY_TURNS);
  const transcript = prior
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 1500)}`)
    .join("\n\n");
  const toc = tocForPlanner(tableOfContents);
  const sections = [
    toc ? `Table of contents:\n${toc}` : "Table of contents: (none detected)",
    transcript ? `Conversation so far:\n\n${transcript}` : null,
    `Latest user message:\n${raw}`,
  ].filter(Boolean);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAN_TIMEOUT_MS);
  try {
    const response = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: getFireworksModel(),
        messages: [
          { role: "system", content: PLAN_SYSTEM },
          { role: "user", content: sections.join("\n\n") },
        ],
        max_tokens: 400,
        temperature: 0,
        stream: false,
        response_format: { type: "json_object" },
        // Fireworks' switch for hidden reasoning on thinking models.
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return fallback;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    const tokens = data.usage?.total_tokens ?? 0;
    const queries = parsePlannedQueries(data.choices?.[0]?.message?.content);
    return queries ? { queries, tokens } : { ...fallback, tokens };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/** The planner's queries, cleaned and capped; null when the output isn't a
 *  usable plan. An empty list is a valid plan (nothing to retrieve). */
export function parsePlannedQueries(content: string | undefined): string[] | null {
  const json = content ? extractJsonSubstring(content) : null;
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { queries?: unknown };
    if (!Array.isArray(parsed.queries)) return null;
    const queries = parsed.queries
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim().slice(0, 300))
      .filter(Boolean);
    return [...new Set(queries)].slice(0, MAX_QUERIES);
  } catch {
    return null;
  }
}
