/**
 * The reading-list judge's rubric: what each research pick is scored on, how
 * the scores combine, and how a list is reordered by them. Pure (no network,
 * no env) so it can be tested; the TypeSafe client lives in
 * `src/server/judge.ts`.
 *
 * Used twice: to screen a wide pool of search results on their content
 * (abstract or page snippet) before the LLM picks the final list, and to
 * score any final pick that wasn't screened. Each candidate gets one request
 * with one Score question per dimension (the "composite scoring" pattern). Every dimension has five levels, so a score
 * runs 0 to 4; it's normalized to 0 to 1 and the weighted sum is the pick's
 * judge score. Tune the weights here.
 */

export interface JudgeDimension {
  id: string;
  weight: number;
  instructions: string;
  /** Ordered low to high. */
  criteria: string[];
}

export const JUDGE_DIMENSIONS: JudgeDimension[] = [
  {
    id: "relevance",
    weight: 0.5,
    instructions:
      "How directly does this source help answer the research question (and serve the project, if one is given)?",
    criteria: [
      "Off-topic: does not address the question",
      "Tangential: shares keywords or a neighboring area but doesn't help answer the question",
      "Partially relevant: addresses one aspect or a narrow special case",
      "Relevant: substantially addresses the question",
      "Central: one of the most direct answers to the question",
    ],
  },
  {
    id: "importance",
    weight: 0.3,
    instructions:
      "How important is this source for understanding the topic of the question?",
    criteria: [
      "Negligible: minor or redundant work",
      "Incremental: a small extension of existing work",
      "Useful: a solid contribution worth knowing",
      "Important: a major contribution, survey, or widely used reference",
      "Essential: a seminal or canonical source that the area builds on",
    ],
  },
  {
    id: "credibility",
    weight: 0.2,
    instructions: "How credible and substantive is this source?",
    criteria: [
      "Unreliable: thin, promotional, or unsupported",
      "Weak: informal with little evidence",
      "Adequate: reasonable evidence or a credible author",
      "Strong: rigorous work or an authoritative author or lab",
      "Authoritative: peer-reviewed or widely cited, from a leading source",
    ],
  },
];

/** What the judge sees about the research a pick came from. */
export interface JudgeContext {
  question: string;
  projectName?: string | null;
}

/** What the judge sees about one candidate. */
export interface JudgeCandidate {
  title: string;
  url: string;
  /** The research agent's case for a pick (post-hoc scoring only). */
  rationale?: string;
  /** What the source says: a paper's abstract or a web page's snippet. */
  content?: string | null;
  arxivId?: string | null;
  authors?: string | null;
  publishedYear?: number | null;
  venue?: string | null;
  citationCount?: number | null;
}

export interface DimensionResult {
  /** 0 to 4. */
  score: number;
  /** 0 to 1, from how spread the level probabilities are. */
  confidence: number;
}

/** Stored per pick so a score can be explained and audited later. */
export interface JudgeDetail {
  model: string;
  dimensions: Record<string, DimensionResult>;
}

/** The request body for TypeSafe's `/v1/systemone`. */
export function buildJudgeRequest(
  context: JudgeContext,
  candidate: JudgeCandidate,
  model: string,
) {
  const source: Record<string, unknown> = {
    title: candidate.title,
    url: candidate.url,
    kind: candidate.arxivId ? "arXiv paper" : "web source",
  };
  if (candidate.authors) source.authors = candidate.authors;
  if (candidate.publishedYear) source.year = candidate.publishedYear;
  if (candidate.venue) source.venue = candidate.venue;
  if (candidate.citationCount != null) source.citations = candidate.citationCount;
  if (candidate.content) source.content = candidate.content;
  if (candidate.rationale) source.why_suggested = candidate.rationale;

  const state: Record<string, unknown> = {
    research_question: context.question,
    source,
  };
  if (context.projectName) state.project = context.projectName;

  const questions: Record<string, unknown> = {};
  for (const d of JUDGE_DIMENSIONS) {
    questions[d.id] = {
      type: "score",
      instructions: d.instructions,
      criteria: d.criteria,
    };
  }
  return { model, state, questions };
}

/** The weighted 0 to 1 score. Missing dimensions are left out and the
 *  remaining weights renormalized; null when nothing came back. */
export function compositeScore(
  dimensions: Record<string, DimensionResult>,
): number | null {
  let total = 0;
  let weight = 0;
  for (const d of JUDGE_DIMENSIONS) {
    const r = dimensions[d.id];
    if (!r || !Number.isFinite(r.score)) continue;
    const top = d.criteria.length - 1;
    total += d.weight * Math.min(1, Math.max(0, r.score / top));
    weight += d.weight;
  }
  return weight > 0 ? total / weight : null;
}

/**
 * Order items by judge score, highest first. Items without a score keep
 * their relative order and go after the scored ones. Ties keep their
 * original order.
 */
export function orderByJudge<T>(
  items: T[],
  scoreOf: (item: T) => number | null | undefined,
): T[] {
  return items
    .map((item, index) => ({ item, index, score: scoreOf(item) }))
    .sort((a, b) => {
      const sa = a.score ?? null;
      const sb = b.score ?? null;
      if (sa !== null && sb !== null && sa !== sb) return sb - sa;
      if (sa !== null && sb === null) return -1;
      if (sa === null && sb !== null) return 1;
      return a.index - b.index;
    })
    .map((x) => x.item);
}
