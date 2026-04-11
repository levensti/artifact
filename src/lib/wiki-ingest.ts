/**
 * Wiki ingest pipeline — generates knowledge base pages from a paper.
 *
 * Called silently in the background when a paper is first opened.
 * Produces: paper summary page, concept/method pages, and an index.
 */

import type { Model } from "@/lib/models";
import { isInferenceProviderType } from "@/lib/models";
import type { WikiPageType } from "@/lib/wiki";
import {
  checkWikiIngested,
  loadWikiPage,
  loadWikiPages,
  saveWikiPage,
  updateWikiPage,
  invalidateWikiCache,
} from "@/lib/client-data";

/* ── JSON parsing helpers (same pattern as explore-analysis.ts) ── */

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/m, "")
    .trim();
}

function extractJsonSubstring(s: string): string {
  const startObj = s.indexOf("{");
  const startArr = s.indexOf("[");
  let start = -1;
  if (startObj === -1) start = startArr;
  else if (startArr === -1) start = startObj;
  else start = Math.min(startObj, startArr);
  if (start === -1) return s;

  const openChar = s[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === openChar) depth++;
    else if (s[i] === closeChar) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s;
}

function parseJson<T>(raw: string, fallback: T): T {
  const cleaned = stripCodeFences(raw);
  const candidates = [cleaned, extractJsonSubstring(cleaned)];
  for (const blob of candidates) {
    try {
      return JSON.parse(blob) as T;
    } catch {
      /* try next */
    }
  }
  return fallback;
}

/* ── LLM call helper ── */

async function generateStructured(
  model: Model,
  apiKey: string,
  prompt: string,
  paperContext: string,
  signal?: AbortSignal,
): Promise<string> {
  const augmented = `${prompt}\n\nReminder: respond with ONLY valid JSON exactly as specified—no markdown, no prose outside the JSON.`;
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

/* ── Slug helper ── */

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* ── Types for LLM output ── */

interface GeneratedPage {
  slug: string;
  title: string;
  pageType: WikiPageType;
  content: string;
  summary: string;
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

  // Generate wiki pages from paper
  const prompt = `You are building a persistent knowledge base wiki from an academic paper. The full paper text is in your context.

Paper title: ${JSON.stringify(paperTitle)}
${arxivId ? `arXiv ID: ${arxivId}` : ""}

Generate wiki pages as a JSON array. For each page, include:
- slug: a URL-friendly identifier (lowercase, hyphens, no spaces)
- title: human-readable page title
- pageType: one of "paper", "concept", "method", "entity"
- content: full markdown content for the page. Use [[slug]] syntax to cross-reference other pages you're creating.
- summary: one sentence for the index

Generate the following pages:
1. ONE "paper" page summarizing this paper (slug should be based on the paper title or arxiv ID). Include: key contributions, methodology overview, main results, and limitations.
2. 3-6 "concept" or "method" pages for the most important technical ideas, techniques, or mathematical concepts in the paper. Each page should explain the concept clearly and note how this paper uses it.

Rules:
- Content should be thorough but concise (200-500 words per page)
- Use LaTeX notation ($..$ or $$..$$) for math where appropriate
- Cross-reference between pages using [[slug]] links
- Each page should be self-contained and useful on its own

Return ONLY a JSON array of page objects. No markdown fences, no extra text.`;

  const raw = await generateStructured(model, apiKey, prompt, paperText, signal);
  const pages = parseJson<GeneratedPage[]>(raw, []);

  if (!Array.isArray(pages) || pages.length === 0) return;

  // Validate and save each page
  const savedSlugs: Array<{ slug: string; title: string; pageType: string; summary: string }> = [];

  for (const page of pages) {
    if (!page.slug || !page.title || !page.content || !page.pageType) continue;

    const slug = toSlug(page.slug);
    if (!slug) continue;

    const validTypes = new Set(["paper", "concept", "method", "entity"]);
    const pageType = validTypes.has(page.pageType) ? page.pageType : "concept";

    // Check if page already exists
    const existing = await loadWikiPage(slug);
    if (existing) {
      // Merge: append new info under a section header
      const mergedContent =
        existing.content +
        `\n\n---\n\n## From: ${paperTitle}\n\n${page.content}`;
      await updateWikiPage(slug, { content: mergedContent });
    } else {
      await saveWikiPage({
        slug,
        title: page.title,
        content: page.content,
        pageType: pageType as WikiPageType,
        reviewId,
      });
    }

    savedSlugs.push({
      slug,
      title: page.title,
      pageType,
      summary: page.summary || page.title,
    });
  }

  if (savedSlugs.length === 0) return;

  // Update index page
  await rebuildIndexPage();

  // Append to log page
  await appendToLog(paperTitle);

  invalidateWikiCache();
}

/* ── Index page ── */

async function rebuildIndexPage(): Promise<void> {
  const allPages = await loadWikiPages();
  const contentPages = allPages.filter(
    (p) => p.pageType !== "index" && p.pageType !== "log",
  );

  if (contentPages.length === 0) return;

  const grouped = new Map<string, typeof contentPages>();
  for (const p of contentPages) {
    const list = grouped.get(p.pageType) ?? [];
    list.push(p);
    grouped.set(p.pageType, list);
  }

  const typeLabels: Record<string, string> = {
    paper: "Papers",
    concept: "Concepts",
    method: "Methods",
    entity: "Entities",
    graph: "Knowledge Graphs",
  };

  let content = "# Knowledge Base Index\n\n";
  content += `*${contentPages.length} pages across ${grouped.size} categories*\n\n`;

  for (const [type, pages] of grouped) {
    content += `## ${typeLabels[type] ?? type}\n\n`;
    for (const p of pages) {
      const firstLine = p.content
        .split("\n")
        .find((l) => l.trim() && !l.startsWith("#"));
      const excerpt = firstLine
        ? firstLine.trim().slice(0, 100) + (firstLine.length > 100 ? "…" : "")
        : "";
      content += `- [[${p.slug}]] — ${excerpt}\n`;
    }
    content += "\n";
  }

  await saveWikiPage({
    slug: "index",
    title: "Knowledge Base Index",
    content,
    pageType: "index",
  });
}

/* ── Log page ── */

async function appendToLog(paperTitle: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const entry = `## [${date}] ingest | ${paperTitle}\n\n`;

  const existing = await loadWikiPage("log");
  if (existing) {
    await updateWikiPage("log", {
      content: existing.content + entry,
    });
  } else {
    await saveWikiPage({
      slug: "log",
      title: "Knowledge Base Log",
      content: `# Knowledge Base Log\n\nChronological record of knowledge base operations.\n\n${entry}`,
      pageType: "log",
    });
  }
}
