/**
 * The discover funnel: search wide, screen with the Jev judge, then let the
 * LLM choose and explain the reading list from the shortlist.
 *
 *   1. Plan     LLM turns the question into ~6-8 paper and ~3-5 web queries.
 *   2. Search   all queries run in parallel; results are pooled and deduped
 *               (up to ~150 candidates), minus anything the project has.
 *   3. Screen   Jev grades every candidate on its content (abstract or page
 *               text) against the question. The top 20 scoring >= 0.5 make
 *               the shortlist (at least 6, so a thin pool still yields one),
 *               skipping sources with weak credibility while enough remain.
 *   4. Final    the LLM agent reads the shortlist, may verify a few papers or
 *               run one targeted search, then submits 4-6 picks with
 *               rationales and writes the overview.
 *
 * The final list is ordered by the screening scores, not by the LLM: the
 * scores travel to the client in a `screen_scores` event and are saved with
 * the picks. Searches emit the same tool events as the agent's own searches,
 * so the research trace renders unchanged, plus one `screen_sources` step.
 *
 * Free of `server-only` / DB / Next-runtime imports, like reading-agent.ts,
 * so the offline evals run it in-process.
 */

import type { StreamEvent, ScreenScore } from "@/lib/stream-types";
import type { TranscriptMessage } from "@/lib/transcript";
import { normalizeArxivId } from "@/lib/arxiv";
import { canonicalUrl } from "@/lib/discover-paper-metadata";
import {
  FIREWORKS_BASE_URL,
  getFireworksModel,
  getFireworksReasoningEffort,
  type ChatUsage,
} from "@/lib/fireworks";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { parseApiErrorMessage } from "@/lib/api-utils";
import { promptFromRecipe } from "@/recipes/types";
import { READING_AGENT_PROMPTS, readingAgentRecipe } from "@/recipes/reading-agent";
import {
  formatPaperSearch,
  searchPapers,
  type PaperResult,
} from "@/tools/arxiv-search";
import { exaSearch, formatWebResults, resolveExaKey } from "@/tools/web-search";
import { getAllTools } from "@/tools/registry";
import type { ToolContext } from "@/tools/types";
import { runFireworksAgentLoop } from "@/app/api/chat/fireworks-handler";
import { judgePicks } from "./judge";

/* ------------------------------------------------------------------ */
/*  Tuning                                                             */
/* ------------------------------------------------------------------ */

const MAX_PAPER_QUERIES = 8;
const MAX_WEB_QUERIES = 5;
const PAPER_RESULTS_PER_QUERY = 20;
const WEB_RESULTS_PER_QUERY = 10;
/** Paper searches run a few at a time to stay polite to Semantic Scholar. */
const PAPER_SEARCH_CONCURRENCY = 4;
const MAX_POOL = 150;
const SHORTLIST_SIZE = 20;
const SHORTLIST_FLOOR = 0.5;
/** A shortlist never shrinks below this, even when few clear the floor. */
const SHORTLIST_MIN = 6;
/** Minimum credibility (0 to 4) to make the shortlist while enough
 *  candidates clear it: topical but thin pages otherwise score well on
 *  relevance alone. */
const CREDIBILITY_FLOOR = 1.5;
/** Characters of a candidate's content sent to the judge and the LLM. */
const CONTENT_CHARS = 1500;
const WEB_CONTENT_CHARS = 1500;
const PLAN_TIMEOUT_MS = 60_000;

const DISCOVER_SUBMIT_NUDGE =
  "You haven't called submit_picks, so the user would see nothing. Call submit_picks NOW " +
  "with the 4–6 strongest candidates from the shortlist, each with a one-sentence rationale " +
  "and its canonical URL. Then write the explainer.";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FunnelParams {
  /** The conversation to answer (its last user turn carries any follow-up
   *  or project context). */
  conversation: TranscriptMessage[];
  /** Fireworks key. */
  apiKey: string;
  model?: string;
  /** The question screening judges against: short, without the prompt's
   *  context scaffolding. */
  question: string;
  projectName?: string | null;
  /** Sources the project already has; dropped before screening. */
  exclude?: { arxivIds?: string[]; urls?: string[] };
  exaApiKey?: string;
  skipWebSearch?: boolean;
  emit: (event: StreamEvent) => void;
}

interface Candidate {
  key: string;
  kind: "paper" | "web";
  title: string;
  url: string;
  arxivId: string | null;
  authors: string | null;
  year: number | null;
  venue: string | null;
  citationCount: number | null;
  content: string;
}

interface Screened extends Candidate {
  score: number | null;
  detail: ScreenScore["detail"] | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function candidateKey(arxivId: string | null, url: string): string {
  return arxivId ? `arxiv:${normalizeArxivId(arxivId)}` : `url:${canonicalUrl(url)}`;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function lastUserText(conversation: TranscriptMessage[]): string {
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i].role === "user") return conversation[i].content;
  }
  return "";
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Report a non-agent model call's usage so the route meters it like the
 *  agent's own rounds. */
function emitUsage(emit: FunnelParams["emit"], usage: ChatUsage | undefined) {
  if (!usage) return;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  emit({
    type: "cache_stats",
    inputTokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
    outputTokens: usage.completion_tokens ?? 0,
  });
}

/* ------------------------------------------------------------------ */
/*  1. Plan                                                            */
/* ------------------------------------------------------------------ */

export interface SearchPlan {
  paperQueries: string[];
  webQueries: string[];
}

/** Pull the plan out of the model's reply, tolerating code fences or stray
 *  prose around the JSON. Exported for tests. */
export function parseSearchPlan(text: string): SearchPlan | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>;
    const strings = (v: unknown) =>
      Array.isArray(v)
        ? [...new Set(v.filter((q): q is string => typeof q === "string").map((q) => q.trim()).filter(Boolean))]
        : [];
    const plan = {
      paperQueries: strings(raw.paper_queries).slice(0, MAX_PAPER_QUERIES),
      webQueries: strings(raw.web_queries).slice(0, MAX_WEB_QUERIES),
    };
    return plan.paperQueries.length + plan.webQueries.length > 0 ? plan : null;
  } catch {
    return null;
  }
}

async function planSearches(p: FunnelParams): Promise<SearchPlan> {
  const fallback = { paperQueries: [p.question], webQueries: [p.question] };
  try {
    const response = await fetchWithTimeout(
      `${FIREWORKS_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${p.apiKey}`,
        },
        body: JSON.stringify({
          model: p.model ?? getFireworksModel(),
          messages: [
            {
              role: "system",
              content: promptFromRecipe(
                readingAgentRecipe,
                READING_AGENT_PROMPTS.discoveryPlan,
              ),
            },
            { role: "user", content: lastUserText(p.conversation) },
          ],
          stream: false,
          max_tokens: 4096,
          reasoning_effort: getFireworksReasoningEffort(),
        }),
      },
      PLAN_TIMEOUT_MS,
    );
    if (!response.ok) {
      const text = await response.text();
      const err = new Error(
        parseApiErrorMessage(text, `Fireworks API error: ${response.status}`),
      );
      if (response.status === 429 || response.status === 402) {
        (err as { isRateLimit?: boolean }).isRateLimit = true;
      }
      throw err;
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: ChatUsage;
    };
    emitUsage(p.emit, data.usage);
    return parseSearchPlan(data.choices?.[0]?.message?.content ?? "") ?? fallback;
  } catch (err) {
    // Out of allowance is the user's problem to fix, not something to paper
    // over with a degraded run.
    if ((err as { isRateLimit?: boolean })?.isRateLimit) throw err;
    console.error("Discover planning failed; searching the question as-is", err);
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/*  2. Search                                                          */
/* ------------------------------------------------------------------ */

function paperCandidate(r: PaperResult): Candidate {
  return {
    key: candidateKey(r.arxivId, r.url),
    kind: "paper",
    title: r.title,
    url: r.arxivId ? `https://arxiv.org/abs/${normalizeArxivId(r.arxivId)}` : r.url,
    arxivId: r.arxivId ? normalizeArxivId(r.arxivId) : null,
    authors: r.authors.length > 0 ? r.authors.slice(0, 8).join(", ") : null,
    year: r.year,
    venue: r.venue,
    citationCount: r.citationCount,
    content: clip(r.abstract, CONTENT_CHARS),
  };
}

/** Run every planned search, emitting each as a tool step for the trace.
 *  Returns candidates interleaved by result rank across queries, so a pool
 *  cap keeps every query's best results. */
async function searchWide(
  p: FunnelParams,
  plan: SearchPlan,
): Promise<{ candidates: Candidate[]; searches: number }> {
  const exaKey = p.skipWebSearch ? "" : resolveExaKey(p.exaApiKey);
  const webQueries = exaKey ? plan.webQueries : [];
  const paperIds = plan.paperQueries.map((_, i) => `funnel-paper-${i}`);
  const webIds = webQueries.map((_, i) => `funnel-web-${i}`);

  // Announce the whole batch up front so the trace shows it in flight.
  plan.paperQueries.forEach((query, i) =>
    p.emit({
      type: "tool_call",
      id: paperIds[i],
      name: "arxiv_search",
      input: { query, max_results: PAPER_RESULTS_PER_QUERY },
    }),
  );
  webQueries.forEach((query, i) =>
    p.emit({
      type: "tool_call",
      id: webIds[i],
      name: "web_search",
      input: { query, count: WEB_RESULTS_PER_QUERY },
    }),
  );

  const [paperLists, webLists] = await Promise.all([
    mapLimit(plan.paperQueries, PAPER_SEARCH_CONCURRENCY, async (query, i) => {
      const outcome = await searchPapers(query, PAPER_RESULTS_PER_QUERY);
      const formatted = formatPaperSearch(query, outcome);
      p.emit({
        type: "tool_result",
        id: paperIds[i],
        name: "arxiv_search",
        output: typeof formatted === "string" ? formatted : formatted.content,
      });
      return outcome.results.map(paperCandidate);
    }),
    Promise.all(
      webQueries.map(async (query, i) => {
        try {
          const results = await exaSearch(
            query,
            WEB_RESULTS_PER_QUERY,
            exaKey,
            WEB_CONTENT_CHARS,
          );
          p.emit({
            type: "tool_result",
            id: webIds[i],
            name: "web_search",
            output:
              results.length > 0
                ? formatWebResults(query, results)
                : `No web results found for: "${query}". Try rephrasing the search.`,
          });
          return results.map<Candidate>((r) => ({
            key: candidateKey(null, r.url),
            kind: "web",
            title: r.title,
            url: r.url,
            arxivId: null,
            authors: null,
            year: null,
            venue: null,
            citationCount: null,
            content: clip(r.description, CONTENT_CHARS),
          }));
        } catch (err) {
          p.emit({
            type: "tool_result",
            id: webIds[i],
            name: "web_search",
            output: `Web search failed: ${err instanceof Error ? err.message : "unknown error"}`,
          });
          return [];
        }
      }),
    ),
  ]);

  const excluded = new Set([
    ...(p.exclude?.arxivIds ?? []).map((id) => candidateKey(id, "")),
    ...(p.exclude?.urls ?? []).map((url) => candidateKey(null, url)),
  ]);
  const lists = [...paperLists, ...webLists];
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let rank = 0; rank < longest; rank++) {
    for (const list of lists) {
      const c = list[rank];
      if (!c || !c.title || seen.has(c.key) || excluded.has(c.key)) continue;
      seen.add(c.key);
      candidates.push(c);
    }
  }
  return {
    candidates: candidates.slice(0, MAX_POOL),
    searches: plan.paperQueries.length + webQueries.length,
  };
}

/* ------------------------------------------------------------------ */
/*  3. Screen                                                          */
/* ------------------------------------------------------------------ */

/** The top candidates by score: up to `SHORTLIST_SIZE` above the floor, and
 *  never fewer than `SHORTLIST_MIN` while candidates remain. Unscored
 *  candidates (judge failures) rank last. Exported for tests. */
export function shortlist<T extends { score: number | null }>(screened: T[]): T[] {
  const ranked = screened
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const sa = a.c.score ?? -1;
      const sb = b.c.score ?? -1;
      return sb - sa || a.i - b.i;
    })
    .map((x) => x.c);
  const passing = ranked.filter((c) => (c.score ?? -1) >= SHORTLIST_FLOOR);
  const size = Math.min(
    ranked.length,
    Math.max(SHORTLIST_MIN, Math.min(SHORTLIST_SIZE, passing.length)),
  );
  return ranked.slice(0, size);
}

async function screen(
  p: FunnelParams,
  candidates: Candidate[],
): Promise<Screened[]> {
  const id = "funnel-screen";
  p.emit({
    type: "tool_call",
    id,
    name: "screen_sources",
    input: { candidates: candidates.length },
  });
  const results = await judgePicks(
    { question: p.question, projectName: p.projectName ?? null },
    candidates.map((c) => ({
      title: c.title,
      url: c.url,
      content: c.content,
      arxivId: c.arxivId,
      authors: c.authors,
      publishedYear: c.year,
      venue: c.venue,
      citationCount: c.citationCount,
    })),
  );
  const screened: Screened[] = candidates.map((c, i) => ({
    ...c,
    score: results[i]?.score ?? null,
    detail: results[i]?.detail ?? null,
  }));
  const credible = screened.filter(
    (c) => (c.detail?.dimensions.credibility?.score ?? 4) >= CREDIBILITY_FLOOR,
  );
  const short = shortlist(credible.length >= SHORTLIST_MIN ? credible : screened);
  const graded = screened.filter((c) => c.score !== null).length;
  p.emit({
    type: "tool_result",
    id,
    name: "screen_sources",
    output:
      graded === 0
        ? `Screening unavailable; passing the first ${short.length} of ${candidates.length} sources through unscored.`
        : `Screened ${graded} sources. Shortlisted ${short.length} (score ≥ ${SHORTLIST_FLOOR.toFixed(2)} where possible).`,
  });
  return short;
}

/* ------------------------------------------------------------------ */
/*  4. Final pass                                                      */
/* ------------------------------------------------------------------ */

function shortlistBlock(short: Screened[], pooled: number, searches: number): string {
  const entries = short.map((c, i) => {
    const meta = [
      c.arxivId ? `arXiv:${c.arxivId}` : c.kind === "web" ? "web" : null,
      c.year ? String(c.year) : null,
      c.venue,
      c.citationCount != null ? `${c.citationCount} citations` : null,
      c.score !== null ? `screen ${c.score.toFixed(2)}` : "unscored",
    ]
      .filter(Boolean)
      .join(" · ");
    return [
      `[S${i + 1}] ${c.title}`,
      `  URL: ${c.url}`,
      `  ${meta}`,
      c.authors ? `  Authors: ${c.authors}` : null,
      c.content ? `  ${c.kind === "paper" ? "Abstract" : "Snippet"}: ${c.content}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    "<shortlist>",
    `${searches} searches found ${pooled} sources. A judge graded each on its content; these ${short.length} scored highest (screen score 0 to 1).`,
    "",
    entries.join("\n\n"),
    "</shortlist>",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/*  Entry                                                              */
/* ------------------------------------------------------------------ */

/** Shown as the brief's message when every search comes back empty; the
 *  brief offers Retry and a follow-up box under it. */
const NOTHING_FOUND =
  "None of the searches returned sources for this question. Try rephrasing it " +
  "with the field's standard terms, or name a specific method, paper, or system.";

export async function runDiscoverFunnel(p: FunnelParams): Promise<void> {
  p.emit({ type: "turn_start" });
  const plan = await planSearches(p);
  const { candidates, searches } = await searchWide(p, plan);
  if (candidates.length === 0) {
    p.emit({ type: "text_delta", text: NOTHING_FOUND });
    return;
  }

  const short = await screen(p, candidates);
  p.emit({
    type: "screen_scores",
    scores: short.flatMap((c) =>
      c.score !== null && c.detail
        ? [{ arxivId: c.arxivId, url: c.url, score: c.score, detail: c.detail }]
        : [],
    ),
  });

  // The final pass sees the user's message (with any project or follow-up
  // context) followed by the shortlist.
  const last = p.conversation.length - 1;
  const conversation: TranscriptMessage[] = p.conversation.map((m, i) =>
    i === last && m.role === "user"
      ? {
          ...m,
          content: `${m.content}\n\n${shortlistBlock(short, candidates.length, searches)}`,
        }
      : m,
  );

  const allowed = new Set(["paper_details", "arxiv_search", "submit_picks"]);
  if (!p.skipWebSearch) allowed.add("web_search");
  const tools = getAllTools().filter((t) => allowed.has(t.name));
  const toolContext: ToolContext = { exaApiKey: p.exaApiKey || undefined };

  await runFireworksAgentLoop(
    conversation,
    p.apiKey,
    promptFromRecipe(readingAgentRecipe, READING_AGENT_PROMPTS.discoveryFinal),
    undefined,
    tools,
    toolContext,
    p.emit,
    {
      requiredFinalTool: {
        name: "submit_picks",
        nudge: DISCOVER_SUBMIT_NUDGE,
        maxNudges: 2,
      },
    },
    p.model,
  );
}
