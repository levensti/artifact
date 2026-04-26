/**
 * Tool: search_paper
 *
 * Lexical search across the parsed paper's sections. Returns ranked
 * passages with their section heading and (when available) page number.
 * For a single document, simple token-overlap scoring is plenty — no
 * embeddings or external indexers needed.
 */

import type { ToolDefinition } from "./types";

export const searchPaperTool: ToolDefinition = {
  name: "search_paper",
  description:
    "Search the paper for passages matching a query. Returns the top-k " +
    "matching passages with their section heading and page. Use when you " +
    'need to find where a concept is discussed (e.g. "where does the paper ' +
    'introduce the loss function?") rather than reading a known section.',
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Free-text query — keywords or short phrase. Will be tokenized; " +
          'no special operators. Example: "ablation results on ImageNet".',
      },
      k: {
        type: "number",
        description: "Number of top passages to return (1-10). Default: 5.",
        default: 5,
      },
    },
    required: ["query"],
  },

  async execute(input, context) {
    const parsed = context.parsedPaper;
    if (!parsed) {
      return (
        "Error: this paper hasn't been parsed into sections yet. " +
        "Search the existing flat paper context directly instead."
      );
    }

    const query = String(input.query ?? "").trim();
    if (!query) return "Error: query is required.";

    const k = Math.max(1, Math.min(10, Number(input.k) || 5));

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return "Error: query produced no searchable tokens.";
    }

    // Score each section by a TF-IDF-ish overlap: sum of (term_count /
    // sqrt(section_len)) for query terms present. Cheap and effective
    // for single-document search.
    const scored = parsed.sections.map((s, idx) => ({
      idx,
      heading: s.heading,
      page: s.startPage,
      body: s.body,
      score: scoreSection(queryTokens, s.body),
    }));

    const ranked = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    if (ranked.length === 0) {
      return `No passages match "${query}".`;
    }

    const blocks = ranked.map((r) => {
      const snippet = bestSnippet(queryTokens, r.body);
      const pageNote = r.page ? ` (p. ${r.page})` : "";
      return `[${r.idx}] ${r.heading}${pageNote}\n${snippet}`;
    });

    return `Top ${ranked.length} matches for "${query}":\n\n${blocks.join("\n\n")}`;
  },
};

/* ------------------------------------------------------------------ */
/*  Lexical scoring                                                    */
/* ------------------------------------------------------------------ */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function scoreSection(queryTokens: string[], body: string): number {
  if (!body) return 0;
  const bodyLower = body.toLowerCase();
  const lenNorm = Math.sqrt(Math.max(50, body.length));
  let score = 0;
  for (const t of queryTokens) {
    // Word-boundary match — avoids "rate" matching "iterate".
    const re = new RegExp(`\\b${escapeRegex(t)}\\b`, "g");
    const matches = bodyLower.match(re);
    if (matches) score += matches.length / lenNorm;
  }
  return score;
}

/** ~250-char snippet centered on the highest-density query-term region. */
function bestSnippet(queryTokens: string[], body: string): string {
  if (!body) return "";
  if (body.length <= 250) return body.trim();

  const bodyLower = body.toLowerCase();
  let bestStart = 0;
  let bestHits = 0;
  const window = 250;

  // Scan in 80-char strides; cheap.
  for (let i = 0; i < body.length - window; i += 80) {
    const slice = bodyLower.slice(i, i + window);
    let hits = 0;
    for (const t of queryTokens) {
      const re = new RegExp(`\\b${escapeRegex(t)}\\b`, "g");
      const m = slice.match(re);
      if (m) hits += m.length;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestStart = i;
    }
  }

  // Trim to word boundaries.
  let start = bestStart;
  let end = Math.min(body.length, bestStart + window);
  while (start > 0 && body[start] !== " " && start > bestStart - 30) start--;
  while (end < body.length && body[end] !== " " && end < bestStart + window + 30) end++;

  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, end).trim()}${suffix}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "at", "to", "for",
  "with", "by", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "we", "our", "you", "your",
  "they", "their", "he", "she", "his", "her", "i", "me", "my",
  "do", "does", "did", "have", "has", "had", "will", "would", "should", "can",
  "could", "may", "might", "must", "if", "then", "else", "when", "where",
  "what", "which", "who", "whom", "how", "why",
  "not", "no", "so", "than", "such", "into", "about", "above", "below",
  "between", "while", "during", "before", "after",
]);
