/**
 * Wiki ingest pipeline — generates knowledge base pages from a paper.
 *
 * Called silently in the background when a paper is first opened.
 * Produces: paper summary page, concept/method pages, and an index.
 */

import type { Model } from "@/lib/models";
import { isInferenceProviderType } from "@/lib/models";
import type { WikiPage, WikiPageType } from "@/lib/wiki";
import {
  checkWikiIngested,
  loadWikiPages,
  finalizeWikiIngest,
  type WikiFinalizePage,
} from "@/lib/client-data";
import { loadWikiSchema } from "@/lib/wiki-schema-client";
import { parseJson } from "@/lib/json-parse";
import { toSlug } from "@/lib/slug";

/* ── LLM call helper ── */

async function generateStructured(
  model: Model,
  apiKey: string,
  prompt: string,
  paperContext: string,
  signal?: AbortSignal,
): Promise<string> {
  const augmented = `${prompt}\n\nReminder: respond with ONLY valid JSON exactly as specified\u2014no markdown, no prose outside the JSON.`;
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: model.modelId,
      provider: model.provider,
      ...(isInferenceProviderType(model.provider)
        ? { profileId: model.profileId }
        : { apiKey }),
      prompt: augmented,
      paperContext,
    }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  const data = await response.json();
  return String(data.content ?? "");
}

/* ── Types for LLM output ── */

interface GeneratedPage {
  slug: string;
  title: string;
  pageType: WikiPageType;
  content: string;
  summary?: string;
  /** Optional supporting quote from the paper that justifies this page. */
  passage?: string;
  /**
   * Optional: if the model wants to UPDATE an existing page, it supplies
   * the full replacement content here and sets `update: true`. Otherwise
   * we treat this as a new page.
   */
  update?: boolean;
}

/* ── Retrieval: pick pages relevant to the incoming paper ── */

/** Tokenize text into lowercase word stems for lightweight scoring. */
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  );
}

/** Score a wiki page against a query-text token bag. */
function relevanceScore(page: WikiPage, queryTokens: Set<string>): number {
  const titleTokens = tokenize(page.title);
  const contentSample = page.content.slice(0, 600);
  const contentTokens = tokenize(contentSample);
  let score = 0;
  for (const t of queryTokens) {
    if (titleTokens.has(t)) score += 3;
    if (contentTokens.has(t)) score += 1;
  }
  return score;
}

interface PageSnippet {
  slug: string;
  title: string;
  pageType: string;
  excerpt: string;
}

/** Return up to `limit` existing wiki pages most related to the paper. */
async function fetchRelevantExistingPages(
  paperTitle: string,
  paperText: string,
  limit = 20,
): Promise<PageSnippet[]> {
  try {
    const all = await loadWikiPages();
    const content = all.filter(
      (p) => p.pageType !== "index" && p.pageType !== "log",
    );
    if (content.length === 0) return [];
    const queryTokens = tokenize(paperTitle + " " + paperText.slice(0, 2000));
    const scored = content
      .map((p) => ({ page: p, score: relevanceScore(p, queryTokens) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored.map(({ page }) => ({
      slug: page.slug,
      title: page.title,
      pageType: page.pageType,
      excerpt:
        page.content
          .split("\n")
          .find((l) => l.trim() && !l.startsWith("#"))
          ?.trim()
          .slice(0, 180) ?? "",
    }));
  } catch {
    return [];
  }
}

/* ── Main ingest function ── */

export interface RunWikiIngestOptions {
  reviewId: string;
  paperTitle: string;
  arxivId: string | null;
  paperText: string;
  model: Model;
  apiKey: string;
  signal?: AbortSignal;
}

export async function runWikiIngest(
  opts: RunWikiIngestOptions,
): Promise<void> {
  const { reviewId, paperTitle, arxivId, paperText, model, apiKey, signal } =
    opts;

  // Guard: already ingested
  const ingested = await checkWikiIngested(reviewId);
  if (ingested) return;

  // Retrieval: pull existing pages relevant to this paper so the LLM can
  // extend them instead of creating parallel duplicates.
  const relevant = await fetchRelevantExistingPages(paperTitle, paperText);
  const existingSection = relevant.length
    ? `\n\nExisting knowledge base pages that may be relevant — prefer UPDATING these with \`update: true\` and emitting the full replacement content when the paper adds to them, instead of creating parallel duplicate pages:\n\n${relevant
        .map((p) => `- [[${p.slug}]] (${p.pageType}) — ${p.title}: ${p.excerpt}`)
        .join("\n")}`
    : "";

  const schema = await loadWikiSchema();

  const prompt = `You are maintaining a persistent Karpathy-style knowledge base wiki. The full paper text is in your context.

Paper title: ${JSON.stringify(paperTitle)}
${arxivId ? `arXiv ID: ${arxivId}` : ""}
${existingSection}

${schema}

Generate a JSON array of up to 15 wiki-page operations. For each entry, include:
- slug: a URL-friendly identifier (lowercase, hyphens, no spaces)
- title: human-readable page title
- pageType: one of "paper", "concept", "method", "entity"
- content: full markdown content for the page. Use [[slug]] syntax to cross-reference OTHER pages (either ones you're creating in this batch, or existing slugs from the list above).
- summary: one sentence for the index
- passage: OPTIONAL — a short exact quote from the paper (≤180 chars) that motivates this page. Stored as provenance.
- update: OPTIONAL — set to true if this entry REPLACES an existing page from the "Existing knowledge base pages" list above with the full rewritten content. Omit or false for new pages.

What to generate:
1. ONE "paper" page summarizing this paper. Include: key contributions, methodology overview, main results, and limitations. Cross-reference the concept/method pages you create.
2. 3-8 NEW "concept" / "method" / "entity" pages for technical ideas not yet in the wiki.
3. 0-6 UPDATED pages from the "Existing knowledge base pages" list where this paper adds meaningful new information. Use \`update: true\` and emit the FULL rewritten content (don't return diffs).

Rules:
- Keep each page tight (150-400 words). Cross-reference liberally with [[slug]].
- Use LaTeX ($..$, $$..$$) for math where appropriate.
- Include a \`passage\` when you can cite a short supporting quote.

Return ONLY a JSON array. No markdown fences, no extra text.`;

  const raw = await generateStructured(model, apiKey, prompt, paperText, signal);
  const pages = parseJson<GeneratedPage[]>(raw, []);

  if (!Array.isArray(pages) || pages.length === 0) return;

  const validTypes = new Set(["paper", "concept", "method", "entity"]);
  const finalizePages: WikiFinalizePage[] = [];

  for (const page of pages) {
    if (!page.slug || !page.title || !page.content || !page.pageType) continue;
    const slug = toSlug(page.slug);
    if (!slug) continue;
    const pageType = validTypes.has(page.pageType)
      ? (page.pageType as WikiPageType)
      : ("concept" as WikiPageType);
    finalizePages.push({
      slug,
      title: page.title,
      content: page.content,
      pageType,
      source: {
        reviewId,
        passage: page.passage?.slice(0, 280),
      },
    });
  }

  if (finalizePages.length === 0) return;

  await finalizeWikiIngest({
    pages: finalizePages,
    logEntry: {
      kind: "ingest",
      label: paperTitle,
    },
    rebuildIndex: true,
  });
}
