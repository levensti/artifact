/**
 * Tool: arxiv_search
 *
 * Searches for academic papers using the Semantic Scholar API (primary)
 * with arXiv API as fallback. Semantic Scholar is faster, more reliable,
 * and doesn't aggressively rate-limit like arXiv's export endpoint.
 */

import type { ToolContext, ToolDefinition } from "./types";
import { judgeAvailable, judgePicks } from "@/server/judge";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { SEMANTIC_SCHOLAR_BASE, semanticScholarHeaders } from "@/lib/semantic-scholar";

export interface PaperResult {
  title: string;
  abstract: string;
  authors: string[];
  year: number | null;
  publishedDate: string | null;
  arxivId: string | null;
  paperId: string;
  venue: string | null;
  citationCount: number | null;
  url: string;
}

function normalizeQueryText(raw: string): string {
  return raw
    .replace(/["']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build a broader fallback query when the original is too specific. */
function synthesizeBroaderQuery(raw: string): string | null {
  const cleaned = normalizeQueryText(raw);
  if (!cleaned) return null;

  // Remove highly specific / often low-recall tokens.
  const tokens = cleaned
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !/^\d{4}$/.test(t)) // years like 2009, 2018
    .filter((t) => !/^arxiv$/i.test(t))
    .filter((t) => !/^\d{4}\.\d{4,5}(v\d+)?$/i.test(t)); // arXiv IDs

  if (tokens.length === 0) return null;

  // Keep meaningful technical words and de-emphasize ultra-long tails.
  const compact = tokens.filter((t) => t.length >= 3).slice(0, 8);
  if (compact.length === 0) return null;

  // Use a phrase-ish query + loose keyword fallback.
  if (compact.length >= 5) {
    const phrase = compact.slice(0, 4).join(" ");
    const tail = compact.slice(4, 7).join(" ");
    return tail ? `${phrase} ${tail}` : phrase;
  }
  return compact.join(" ");
}

/* ------------------------------------------------------------------ */
/*  Semantic Scholar (primary)                                         */
/* ------------------------------------------------------------------ */

interface S2Paper {
  paperId: string;
  title: string;
  abstract: string | null;
  authors: Array<{ name: string }>;
  year: number | null;
  venue: string | null;
  citationCount: number | null;
  externalIds: Record<string, string> | null;
  url: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  maxRetries = 2,
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);

    const response = await fetchWithTimeout(url, { headers });

    if (response.status === 429) {
      // Check for Retry-After header
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter && attempt < maxRetries - 1) {
        await sleep(Math.min(Number(retryAfter) * 1000 || 5000, 8000));
        continue;
      }
      if (attempt < maxRetries - 1) continue;
    }

    return response;
  }

  throw new Error("Max retries exceeded");
}

async function searchSemanticScholar(query: string, limit: number): Promise<PaperResult[]> {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: "title,abstract,authors,year,venue,citationCount,externalIds,url",
  });

  const response = await fetchWithRetry(
    `${SEMANTIC_SCHOLAR_BASE}/paper/search?${params}`,
    semanticScholarHeaders(),
  );

  if (!response.ok) {
    throw new Error(`Semantic Scholar API returned ${response.status}`);
  }

  const data = (await response.json()) as { data?: S2Paper[] };
  if (!data.data) return [];

  return data.data
    .filter((p) => p.title)
    .map((p) => ({
      title: p.title,
      abstract: p.abstract ?? "",
      authors: p.authors.map((a) => a.name),
      year: p.year,
      publishedDate: null,
      arxivId: p.externalIds?.ArXiv ?? null,
      paperId: p.paperId,
      venue: p.venue || null,
      citationCount: p.citationCount,
      url: p.externalIds?.ArXiv
        ? `https://arxiv.org/abs/${p.externalIds.ArXiv}`
        : p.url,
    }));
}

/* ------------------------------------------------------------------ */
/*  arXiv fallback                                                     */
/* ------------------------------------------------------------------ */

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1]?.trim() ?? null;
}

function extractAll(xml: string, regex: RegExp): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null = regex.exec(xml);
  while (match) {
    out.push(match[1].trim());
    match = regex.exec(xml);
  }
  return out;
}

async function searchArxivFallback(query: string, maxResults: number): Promise<PaperResult[]> {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

  const response = await fetchWithRetry(url, {
    "User-Agent": "Artifact/1.0 (academic research tool)",
  });

  if (!response.ok) {
    throw new Error(`arXiv API returned ${response.status}`);
  }

  const xml = await response.text();
  return xml
    .split("<entry>")
    .slice(1)
    .map((part) => {
      const entry = `<entry>${part}`;
      const idRaw = extractTag(entry, "id") ?? "";
      const arxivId = (idRaw.match(/\/abs\/([^v<\s]+)/)?.[1] ?? "").trim();
      const publishedDate = extractTag(entry, "published")?.slice(0, 10) ?? null;
      return {
        title: (extractTag(entry, "title") ?? "").replace(/\s+/g, " ").trim(),
        abstract: (extractTag(entry, "summary") ?? "").replace(/\s+/g, " ").trim(),
        authors: extractAll(entry, /<name>([\s\S]*?)<\/name>/g),
        year: publishedDate ? Number(publishedDate.slice(0, 4)) : null,
        publishedDate,
        arxivId: arxivId || null,
        paperId: arxivId,
        venue: null,
        citationCount: null,
        url: arxivId ? `https://arxiv.org/abs/${arxivId}` : "",
      };
    })
    .filter((e) => e.title);
}

/* ------------------------------------------------------------------ */
/*  Structured search (shared by the tool and the discover funnel)     */
/* ------------------------------------------------------------------ */

export interface PaperSearchOutcome {
  results: PaperResult[];
  /** "Semantic Scholar" or "arXiv". */
  source: string;
  /** The query that produced the results (may be a broadened form). */
  usedQuery: string;
  /** Set when every backend failed. */
  error?: string;
  /** The broader query also tried, when the original found nothing. */
  broadenedTo?: string;
}

/** Search papers, falling back from Semantic Scholar to arXiv and from the
 *  query to a broader form of it when nothing comes back. */
export async function searchPapers(
  query: string,
  maxResults: number,
): Promise<PaperSearchOutcome> {
  const queryAttempts = [query, synthesizeBroaderQuery(query)].filter(
    (q, i, arr): q is string => !!q && arr.indexOf(q) === i,
  );

  let results: PaperResult[] = [];
  let source = "Semantic Scholar";
  let usedQuery = query;
  let lastErr: unknown = null;

  for (const attemptQuery of queryAttempts) {
    usedQuery = attemptQuery;
    try {
      results = await searchSemanticScholar(attemptQuery, maxResults);
      source = "Semantic Scholar";
    } catch {
      try {
        results = await searchArxivFallback(attemptQuery, maxResults);
        source = "arXiv";
      } catch (err) {
        lastErr = err;
        continue;
      }
    }
    if (results.length > 0) break;
  }

  return {
    results,
    source,
    usedQuery,
    broadenedTo: queryAttempts[1],
    ...(results.length === 0 && lastErr
      ? { error: lastErr instanceof Error ? lastErr.message : "unknown error" }
      : {}),
  };
}

/** The tool's text output for a search outcome. The client parses this
 *  format to show sources (see discover-paper-metadata). */
export function formatPaperSearch(
  query: string,
  outcome: PaperSearchOutcome,
): string | { content: string; ok: false } {
  const { results, source, usedQuery, error, broadenedTo } = outcome;
  if (results.length === 0 && error) {
    return {
      content: `Paper search failed: ${error}. Both Semantic Scholar and arXiv are unavailable.`,
      ok: false,
    };
  }
  if (results.length === 0) {
    const broadened = broadenedTo ? ` Also tried broader query: "${broadenedTo}".` : "";
    return {
      content: `No papers found for: "${query}". Try broader concepts (method family, task, or domain) instead of very specific phrases.${broadened}`,
      ok: false,
    };
  }

  const broadenNote =
    usedQuery !== query
      ? `\n(Broadened from "${query}" to "${usedQuery}" for better recall.)`
      : "";

  const formatted = results.map((r, i) => {
    const authors =
      r.authors.slice(0, 4).join(", ") + (r.authors.length > 4 ? " et al." : "");
    const meta = [
      r.publishedDate ?? (r.year ? String(r.year) : null),
      r.venue ? r.venue : null,
      r.citationCount != null ? `${r.citationCount} citations` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const abstractSnippet =
      r.abstract.length > 300 ? r.abstract.slice(0, 297) + "..." : r.abstract;

    return [
      `[${i + 1}] ${r.title}`,
      `    ${r.url}${meta ? ` | ${meta}` : ""}`,
      `    Authors: ${authors}`,
      abstractSnippet ? `    ${abstractSnippet}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `Found ${results.length} papers for "${usedQuery}" (via ${source}).${broadenNote}\n\n${formatted.join("\n\n")}`;
}

/* ------------------------------------------------------------------ */
/*  Relevance screening (Jev)                                          */
/* ------------------------------------------------------------------ */

/** Pool fetched when screening, so dropping weak hits still leaves enough. */
const SCREEN_POOL = 20;
/** Same bars as the discover funnel's screen step. */
const SCREEN_FLOOR = 0.5;
const CREDIBILITY_FLOOR = 1.5;
/** Keep at least this many results even when few clear the floors. */
const SCREEN_MIN = 3;

/**
 * Grade a search pool with the Jev judge against the query, read in the
 * context of the paper being reviewed, and return the best `maxResults` in
 * score order. Drops the paper itself. Falls back to the search engine's
 * order when the judge returns nothing usable.
 */
async function screenForReader(
  query: string,
  results: PaperResult[],
  maxResults: number,
  context: ToolContext,
): Promise<{ results: PaperResult[]; screened: boolean }> {
  const ownId = context.arxivId?.replace(/v\d+$/, "");
  const pool = results.filter(
    (r) => !ownId || r.arxivId?.replace(/v\d+$/, "") !== ownId,
  );
  const paper = context.paperTitle ?? `arXiv:${context.arxivId}`;
  const question = `${query} (for a reader of the paper "${paper}")`;
  const scores = await judgePicks(
    { question },
    pool.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.abstract || null,
      arxivId: r.arxivId,
      authors: r.authors.join(", ") || null,
      publishedYear: r.year,
      venue: r.venue,
      citationCount: r.citationCount,
    })),
  );
  if (scores.every((s) => s === null)) {
    return { results: pool.slice(0, maxResults), screened: false };
  }

  const ranked = pool
    .map((r, i) => ({ r, i, s: scores[i] }))
    .sort((a, b) => (b.s?.score ?? -1) - (a.s?.score ?? -1) || a.i - b.i);
  // Like the funnel: skip weak-credibility sources while enough remain, then
  // apply the score floor, topping up from the best of the rest if needed.
  const min = Math.min(SCREEN_MIN, maxResults);
  const credible = ranked.filter(
    (x) => (x.s?.detail.dimensions.credibility?.score ?? 4) >= CREDIBILITY_FLOOR,
  );
  const base = credible.length >= min ? credible : ranked;
  const passing = base.filter((x) => (x.s?.score ?? -1) >= SCREEN_FLOOR);
  const chosen = passing.length >= min ? passing : base.slice(0, min);
  return {
    results: chosen.slice(0, maxResults).map((x) => x.r),
    screened: true,
  };
}

/* ------------------------------------------------------------------ */
/*  Tool definition                                                    */
/* ------------------------------------------------------------------ */

export const arxivSearchTool: ToolDefinition = {
  name: "arxiv_search",
  description:
    "Search for academic papers via Semantic Scholar (primary; indexes arXiv plus major venues: " +
    "NeurIPS, ICML, ICLR, journals, conference proceedings) with the arXiv API as fallback. This is " +
    "a paper-search tool: given a topic, method, author, or keywords it returns matching papers with " +
    "titles, abstracts, authors, citation counts, and links (arXiv URL when available, Semantic " +
    "Scholar URL otherwise). Use it to find or cite real papers: related work, a reading list, or a " +
    "specific reference. Issue multiple distinct sub-queries in parallel when one query won't cover " +
    "the angles you care about.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query, in natural language keywords or phrases. " +
          'Example: "attention mechanism transformers" or "variational autoencoders image generation"',
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (1-20). Default: 8.",
        default: 8,
      },
    },
    required: ["query"],
  },

  async execute(input: Record<string, unknown>, context: ToolContext) {
    const query = String(input.query ?? "").trim();
    if (!query) return { content: "Error: query parameter is required.", ok: false };
    const maxResults = Math.max(1, Math.min(20, Number(input.max_results) || 8));
    // Screen only in a paper chat, where "relevant" has an anchor. Without a
    // judge, or outside a paper (the discover funnel screens on its own),
    // keep the search engine's order.
    if (!judgeAvailable() || !(context.paperTitle || context.arxivId)) {
      return formatPaperSearch(query, await searchPapers(query, maxResults));
    }

    const outcome = await searchPapers(query, SCREEN_POOL);
    if (outcome.results.length === 0) return formatPaperSearch(query, outcome);
    const { results, screened } = await screenForReader(
      query,
      outcome.results,
      maxResults,
      context,
    );
    const formatted = formatPaperSearch(query, { ...outcome, results });
    if (!screened || typeof formatted !== "string") return formatted;
    return formatted.replace(
      /^(Found \d+ papers for .*?\(via [^)]+\)\.)/,
      `$1 Screened ${outcome.results.length} results for relevance; best first.`,
    );
  },
};
