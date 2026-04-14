/**
 * Post-chat background wiki extraction — extracts wiki-worthy concepts
 * from assistant responses and silently saves them to the knowledge base.
 *
 * Completely ambient: all errors are silently caught, no UI indication.
 */

import type { Model } from "@/lib/models";
import { isInferenceProviderType } from "@/lib/models";
import type { WikiPageType } from "@/lib/wiki";
import {
  finalizeWikiIngest,
  type WikiFinalizePage,
} from "@/lib/client-data";
import { beginWikiIngest, endWikiIngest } from "@/lib/wiki-status";

/* ── Rate limiting ── */

const lastExtractTime = new Map<string, number>();
const RATE_LIMIT_MS = 60_000;

/* ── JSON parsing helpers ── */

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/m, "")
    .trim();
}

function extractJsonSubstring(s: string): string {
  const startArr = s.indexOf("[");
  if (startArr === -1) return s;

  let depth = 0;
  for (let i = startArr; i < s.length; i++) {
    if (s[i] === "[") depth++;
    else if (s[i] === "]") {
      depth--;
      if (depth === 0) return s.slice(startArr, i + 1);
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

/* ── Slug helper ── */

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/* ── Types ── */

interface ExtractedPage {
  slug: string;
  title: string;
  pageType: WikiPageType;
  content: string;
}

export interface ExtractWikiFromResponseOptions {
  responseText: string;
  paperTitle: string;
  reviewId: string;
  model: Model;
  apiKey: string;
}

/* ── Main extraction function ── */

export async function extractWikiFromResponse(
  opts: ExtractWikiFromResponseOptions,
): Promise<void> {
  // Guard: response too short
  if (opts.responseText.length < 300) return;

  // Guard: rate limit per review
  const lastTime = lastExtractTime.get(opts.reviewId) ?? 0;
  if (Date.now() - lastTime < RATE_LIMIT_MS) return;
  lastExtractTime.set(opts.reviewId, Date.now());

  const statusToken = beginWikiIngest({
    kind: "chat-extract",
    label: opts.paperTitle ? `From chat: ${opts.paperTitle}` : "From chat",
  });
  try {
    await runExtract(opts);
  } finally {
    endWikiIngest(statusToken);
  }
}

async function runExtract(
  opts: ExtractWikiFromResponseOptions,
): Promise<void> {
  const { responseText, paperTitle, reviewId, model, apiKey } = opts;

  const prompt = `You are analyzing an assistant response from a paper review conversation to extract knowledge worth preserving in a wiki.

Paper: ${JSON.stringify(paperTitle)}

Assistant response:
${responseText.slice(0, 3000)}

Extract 0-3 concepts, methods, or entities worth saving as knowledge base pages. Only extract things that are:
- Well-explained in the response (substantial content, not just a brief mention)
- General knowledge that would be useful across multiple papers
- Not just a direct quote or restatement of user text

For each extracted item, return:
- slug: URL-friendly identifier (lowercase, hyphens)
- title: human-readable page title
- pageType: one of "concept", "method", "entity"
- content: full markdown content for the wiki page (150-400 words), using [[slug]] cross-references where relevant

Return a JSON array. Return an empty array [] if nothing is wiki-worthy.
No markdown fences, no extra text \u2014 ONLY the JSON array.`;

  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.modelId,
      provider: model.provider,
      ...(isInferenceProviderType(model.provider)
        ? { profileId: model.profileId }
        : { apiKey }),
      prompt:
        prompt +
        "\n\nReminder: respond with ONLY valid JSON exactly as specified\u2014no markdown, no prose outside the JSON.",
      paperContext: "",
    }),
  });

  if (!response.ok) return;

  const data = await response.json();
  const raw = String(data.content ?? "");
  const pages = parseJson<ExtractedPage[]>(raw, []);

  if (!Array.isArray(pages) || pages.length === 0) return;

  const validTypes = new Set(["concept", "method", "entity"]);
  const finalizePages: WikiFinalizePage[] = [];

  for (const page of pages) {
    if (!page.slug || !page.title || !page.content || !page.pageType) continue;
    if (!validTypes.has(page.pageType)) continue;

    const slug = toSlug(page.slug);
    if (!slug) continue;

    finalizePages.push({
      slug,
      title: page.title,
      content: page.content,
      pageType: page.pageType,
      source: { reviewId },
    });
  }

  if (finalizePages.length === 0) return;

  await finalizeWikiIngest({
    pages: finalizePages,
    logEntry: {
      kind: "chat-extract",
      label: paperTitle ? `From chat: ${paperTitle}` : "From chat",
    },
    rebuildIndex: true,
  });
}
