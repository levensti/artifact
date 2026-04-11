/**
 * KB ingest pipeline — extracts concepts, methods, results, and a paper summary
 * from a reviewed paper and merges them into the Knowledge Base.
 *
 * Follows the same client-side LLM pattern as explore-analysis.ts:
 * calls /api/generate for structured output, then persists via client-data helpers.
 */

import type { Model } from "@/lib/models";
import { isInferenceProviderType } from "@/lib/models";
import type { WikiPageType } from "@/lib/kb-types";
import {
  loadWikiPage,
  saveWikiPage,
  updateWikiPage,
  invalidateKbCache,
} from "@/lib/client-data";

/* ------------------------------------------------------------------ */
/* JSON helpers (same as explore-analysis.ts)                         */
/* ------------------------------------------------------------------ */

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

function truncateForPrompt(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

/* ------------------------------------------------------------------ */
/* LLM call helper                                                     */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Types for extraction output                                         */
/* ------------------------------------------------------------------ */

interface ExtractedEntity {
  slug: string;
  title: string;
  pageType: WikiPageType;
  content: string;
  relatedSlugs: string[];
  tags: string[];
}

interface ExtractionResult {
  paperSummary: ExtractedEntity;
  entities: ExtractedEntity[];
}

const VALID_PAGE_TYPES = new Set<WikiPageType>([
  "concept",
  "method",
  "result",
  "paper-summary",
  "topic",
]);

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface RunKbIngestOptions {
  reviewId: string;
  paperTitle: string;
  paperContext: string;
  chatHistory?: string;
  model: Model;
  apiKey: string;
  signal?: AbortSignal;
  onProgress?: (phase: string) => void;
}

export interface RunKbIngestResult {
  created: number;
  updated: number;
  pageIds: string[];
}

export async function runKbIngest(
  opts: RunKbIngestOptions,
): Promise<RunKbIngestResult> {
  const {
    reviewId,
    paperTitle,
    paperContext,
    chatHistory,
    model,
    apiKey,
    signal,
    onProgress,
  } = opts;

  const report = (s: string) => onProgress?.(s);

  /* ------ Step 1: Extract entities from the paper ------ */
  report("Extracting knowledge entities…");

  const chatBlock = chatHistory
    ? `\n\nRelevant chat history (for additional context):\n${truncateForPrompt(chatHistory, 3000)}`
    : "";

  const extractPrompt = `You are extracting knowledge entities from a research paper into a personal wiki/knowledge base.

Paper title: ${JSON.stringify(paperTitle)}
${chatBlock}

The full paper text is in your context. Analyze it and extract:

1. **One paper-summary** page — a concise summary of the paper's contributions, methods, and key results.
2. **3–8 concept/method/result entities** — the most important standalone knowledge items from this paper.

For each entity, produce:
- slug: URL-friendly identifier (lowercase, hyphens, e.g. "attention-mechanism")
- title: Human-readable title
- pageType: one of "concept", "method", "result", "paper-summary", "topic"
- content: Markdown content (2–4 paragraphs). Write in evergreen third-person style ("The attention mechanism computes..." not "this paper proposes..."). Use [[slug]] syntax for cross-references to other entities you're extracting. Include LaTeX for math where appropriate (wrap in $ or $$).
- relatedSlugs: array of slugs this entity cross-references
- tags: 2–4 classification tags

Guidelines:
- Be specific and dense — researchers value depth over verbosity
- Use [[slug]] cross-references liberally between the entities you extract
- For the paper-summary, include: motivation, key methods, main results, and significance
- For concepts/methods: explain what it is, how it works, and why it matters — not just that this paper uses it
- Prefer canonical/widely-used slugs (e.g. "transformer" not "transformer-architecture-2017")

Return ONLY valid JSON:
{
  "paperSummary": { "slug": "...", "title": "...", "pageType": "paper-summary", "content": "...", "relatedSlugs": [...], "tags": [...] },
  "entities": [
    { "slug": "...", "title": "...", "pageType": "concept|method|result", "content": "...", "relatedSlugs": [...], "tags": [...] }
  ]
}`;

  const extractRaw = await generateStructured(
    model,
    apiKey,
    extractPrompt,
    paperContext,
    signal,
  );

  const parsed = parseJson<Partial<ExtractionResult>>(extractRaw, {});

  // Validate paper summary
  const paperSummary = parsed.paperSummary;
  if (
    !paperSummary ||
    typeof paperSummary.slug !== "string" ||
    typeof paperSummary.title !== "string" ||
    typeof paperSummary.content !== "string"
  ) {
    throw new Error(
      "Could not parse paper summary from model output. Try again or switch model.",
    );
  }
  paperSummary.pageType = "paper-summary";
  paperSummary.relatedSlugs = Array.isArray(paperSummary.relatedSlugs)
    ? paperSummary.relatedSlugs
    : [];
  paperSummary.tags = Array.isArray(paperSummary.tags) ? paperSummary.tags : [];

  // Validate entities
  const rawEntities = Array.isArray(parsed.entities) ? parsed.entities : [];
  const entities: ExtractedEntity[] = rawEntities
    .filter(
      (e): e is ExtractedEntity =>
        !!e &&
        typeof e.slug === "string" &&
        e.slug.trim().length >= 2 &&
        typeof e.title === "string" &&
        e.title.trim().length >= 2 &&
        typeof e.content === "string" &&
        e.content.trim().length >= 50,
    )
    .map((e) => ({
      ...e,
      slug: e.slug.trim().toLowerCase().replace(/\s+/g, "-"),
      pageType: VALID_PAGE_TYPES.has(e.pageType) ? e.pageType : "concept",
      relatedSlugs: Array.isArray(e.relatedSlugs) ? e.relatedSlugs : [],
      tags: Array.isArray(e.tags) ? e.tags : [],
    }))
    .slice(0, 8);

  const allEntities = [paperSummary, ...entities];

  /* ------ Step 2: Merge with existing pages ------ */
  report("Merging into Knowledge Base…");

  let created = 0;
  let updated = 0;
  const pageIds: string[] = [];

  for (const entity of allEntities) {
    signal?.throwIfAborted();

    const existing = await loadWikiPage(entity.slug);

    if (existing) {
      // Merge: append new content with source attribution
      report(`Updating "${entity.title}"…`);

      const mergePrompt = `You are merging new information into an existing Knowledge Base wiki page.

Existing page content:
${truncateForPrompt(existing.content, 4000)}

New information to merge (from paper: ${JSON.stringify(paperTitle)}):
${truncateForPrompt(entity.content, 3000)}

Instructions:
- Produce the COMPLETE updated page content (not just the diff)
- Preserve all existing information — do not remove or contradict it unless explicitly wrong
- Integrate the new information smoothly into the existing structure
- If there are new cross-references, add them using [[slug]] syntax
- Add a brief attribution note like "As shown in [[${paperSummary.slug}|${paperTitle}]], ..." when incorporating new findings
- Maintain the same evergreen third-person writing style
- Keep YAML frontmatter if present, updating it as needed

Return ONLY valid JSON:
{"content": "the complete updated markdown content"}`;

      const mergeRaw = await generateStructured(
        model,
        apiKey,
        mergePrompt,
        "",
        signal,
      );
      const mergeResult = parseJson<{ content?: string }>(mergeRaw, {});

      if (mergeResult.content && mergeResult.content.trim().length > 50) {
        // Merge tags
        const mergedTags = [
          ...new Set([
            ...(existing.tags ?? []),
            ...entity.tags,
          ]),
        ];

        await updateWikiPage(entity.slug, {
          content: mergeResult.content.trim(),
          tags: mergedTags,
        });
        pageIds.push(existing.id);
        updated++;
      }
    } else {
      // Create new page
      report(`Creating "${entity.title}"…`);
      const saved = await saveWikiPage({
        slug: entity.slug.trim().toLowerCase().replace(/\s+/g, "-"),
        title: entity.title.trim(),
        content: entity.content.trim(),
        pageType: entity.pageType,
        tags: entity.tags.map((t) => t.trim()).filter(Boolean),
      });
      pageIds.push(saved.id);
      created++;
    }
  }

  /* ------ Step 3: Log the ingest ------ */
  // Log is created server-side via the API routes when pages are created/updated.
  // Invalidate the client cache so UI reflects changes.
  invalidateKbCache();

  report("Done.");
  return { created, updated, pageIds };
}
