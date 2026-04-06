/**
 * Wiki compilation pipeline.
 *
 * After a paper is analyzed, this module asks the LLM to identify concepts
 * worth documenting, then creates or updates wiki articles that synthesize
 * knowledge across all reviewed papers.
 *
 * Design principles (from Karpathy's LLM Knowledge Bases):
 * - The LLM writes and maintains all wiki content; users rarely touch it.
 * - Each new paper incrementally enriches the wiki.
 * - An LLM-maintained index lets the model navigate without RAG.
 */

import type { Model } from "@/lib/models";
import { isInferenceProviderType } from "@/lib/models";
import type { WikiArticle, WikiIndexEntry } from "@/lib/wiki";
import {
  getWikiArticlesSnapshot,
  saveWikiArticle,
} from "@/lib/client-data";

/* ── Helpers ── */

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

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

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

/* ── Types ── */

interface ArticlePlan {
  slug: string;
  title: string;
  category: string;
  action: "create" | "update";
  summary: string;
}

interface ArticleContent {
  slug: string;
  contentMd: string;
  summary: string;
  relatedSlugs: string[];
}

/* ── Public API ── */

export interface WikiCompileOptions {
  reviewId: string;
  paperTitle: string;
  paperContext: string;
  model: Model;
  apiKey: string;
  signal?: AbortSignal;
  onProgress?: (phase: string) => void;
}

/**
 * Run the wiki compilation pipeline for a paper.
 * Returns the number of articles created or updated.
 */
export async function runWikiCompilation(
  opts: WikiCompileOptions,
): Promise<number> {
  const { reviewId, paperTitle, paperContext, model, apiKey, signal, onProgress } = opts;
  const report = (s: string) => onProgress?.(s);

  // Build the current wiki index for context
  const existingArticles = getWikiArticlesSnapshot();
  const wikiIndex: WikiIndexEntry[] = existingArticles.map((a) => ({
    slug: a.slug,
    title: a.title,
    category: a.category,
    summary: a.summary,
  }));

  const wikiIndexBlock =
    wikiIndex.length > 0
      ? `\n\nExisting wiki articles (JSON):\n${JSON.stringify(wikiIndex, null, 1)}`
      : "\n\nThe wiki is currently empty — all articles will be new.";

  // Phase 1: Plan which articles to create/update
  report("Planning wiki updates…");
  const planPrompt = `You are maintaining a personal research knowledge base (wiki) that synthesizes concepts across academic papers. The full text of a newly reviewed paper is in your context.

Paper title: ${JSON.stringify(paperTitle)}
${wikiIndexBlock}

Task: Identify 2–5 **concept-level articles** that should be created or updated based on this paper. Focus on:
- Key methods, techniques, or algorithms introduced or discussed
- Important theoretical concepts or frameworks
- Datasets or benchmarks if they are central to the paper
- Comparisons or contrasts with other approaches (if the wiki already has related articles)

Rules:
- Each article should cover a **concept** (not a paper). Think "Attention Mechanisms" not "Vaswani et al. 2017".
- For existing articles: only mark as "update" if this paper adds meaningful new information.
- For new articles: pick titles that are precise but could span multiple papers.
- Categories: "concepts", "methods", "architectures", "datasets", "comparisons", "theory"
- slug: lowercase, hyphens, max 80 chars
- summary: 1 concise sentence describing what the article covers

Return **only** valid JSON:
{"articles":[{"slug":"...","title":"...","category":"...","action":"create"|"update","summary":"..."}]}`;

  const planRaw = await generateStructured(model, apiKey, planPrompt, truncateForPrompt(paperContext, 80000), signal);
  const parsed = parseJson<{ articles?: ArticlePlan[] }>(planRaw, {});
  const plans = (parsed.articles ?? [])
    .filter(
      (p) =>
        typeof p.slug === "string" &&
        p.slug.trim().length > 0 &&
        typeof p.title === "string" &&
        (p.action === "create" || p.action === "update"),
    )
    .slice(0, 5);

  if (plans.length === 0) {
    return 0;
  }

  // Phase 2: Generate content for each article
  let articlesWritten = 0;

  for (const plan of plans) {
    report(`Writing article: ${plan.title}…`);

    const existing = existingArticles.find((a) => a.slug === plan.slug);
    const existingContent = existing
      ? `\n\nCurrent article content (update/extend this — preserve existing information while adding new insights from the current paper):\n\`\`\`markdown\n${truncateForPrompt(existing.contentMd, 6000)}\n\`\`\``
      : "";

    const contentPrompt = `You are writing a wiki article for a personal research knowledge base. The full text of the current paper is in your context.

Article: ${JSON.stringify(plan.title)} (${plan.category})
Action: ${plan.action}
Paper being incorporated: ${JSON.stringify(paperTitle)}
${existingContent}

${wikiIndex.length > 0 ? `Other wiki articles you can link to: ${wikiIndex.map((a) => `[[${a.slug}|${a.title}]]`).join(", ")}` : ""}

Write the article in markdown. Guidelines:
- Be precise, technical, and dense with insight — this is for a researcher.
- Use LaTeX notation ($...$) for math when appropriate.
- Reference specific papers by name when discussing their contributions.
- Include a "## Papers" section at the end listing papers that informed this article (as a bulleted list).
- Use wiki-style links [[slug|display text]] to link to other articles where relevant.
- For "update" action: integrate new information from the current paper into the existing content naturally — don't just append.
- For "create" action: write a comprehensive article covering the concept, not just what this one paper says about it. Use your knowledge to provide broader context.
- Keep articles focused: 200–600 words.

Also provide:
- summary: one-line summary (for the wiki index)
- relatedSlugs: array of slugs from existing articles that this article relates to

Return **only** valid JSON:
{"contentMd":"...","summary":"...","relatedSlugs":["..."]}`;

    try {
      const contentRaw = await generateStructured(
        model,
        apiKey,
        contentPrompt,
        truncateForPrompt(paperContext, 60000),
        signal,
      );
      const content = parseJson<ArticleContent>(contentRaw, {
        slug: plan.slug,
        contentMd: "",
        summary: plan.summary,
        relatedSlugs: [],
      });

      if (!content.contentMd || content.contentMd.length < 50) continue;

      const now = new Date().toISOString();
      const article: WikiArticle = {
        id: existing?.id ?? crypto.randomUUID(),
        slug: slugify(plan.slug),
        title: plan.title,
        category: plan.category,
        contentMd: content.contentMd,
        summary: content.summary || plan.summary,
        sourceReviewIds: [
          ...new Set([...(existing?.sourceReviewIds ?? []), reviewId]),
        ],
        relatedSlugs: (content.relatedSlugs ?? []).filter(
          (s) => typeof s === "string" && s.length > 0,
        ),
        generatedAt: existing?.generatedAt ?? now,
        updatedAt: now,
      };

      await saveWikiArticle(article);
      articlesWritten++;
    } catch (err) {
      // Non-fatal: log and continue with remaining articles
      console.warn(
        `[wiki-compile] Failed to generate article "${plan.title}":`,
        err,
      );
    }
  }

  return articlesWritten;
}
