/**
 * Client-side paper exploration pipeline (prerequisites + arXiv + related-work graph).
 * Used by the Assistant learning tools; persists via explore storage helpers.
 */

import type { Model } from "@/lib/models";
import type {
  ArxivSearchResult,
  GraphData,
  GraphNode,
  Prerequisite,
  PrerequisitesData,
  RelationshipType,
} from "@/lib/explore";
import {
  getPrerequisites,
  mergeSessionGraphIntoGlobal,
  saveGraphData,
  savePrerequisites,
} from "@/lib/explore";

const VALID_DIFFICULTIES = new Set(["foundational", "intermediate", "advanced"]);
const VALID_RELATIONSHIPS = new Set<RelationshipType>([
  "builds-upon",
  "extends",
  "similar-approach",
  "prerequisite",
  "contrasts-with",
  "surveys",
]);

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

function prereqTopicKey(topic: string): string {
  return topic.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeKeywordQueries(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const q = typeof r === "string" ? r.replace(/\s+/g, " ").trim() : "";
    if (q.length < 2 || q.length > 120) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= 8) break;
  }
  return out;
}

async function generateStructured(
  model: Model,
  apiKey: string,
  prompt: string,
  paperContext: string,
  signal?: AbortSignal,
  options?: { jsonOnly?: boolean },
): Promise<string> {
  const augmented =
    options?.jsonOnly === true
      ? `${prompt}\n\nReminder: respond with ONLY valid JSON exactly as specified—no markdown, no prose outside the JSON.`
      : prompt;
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: model.modelId,
      provider: model.provider,
      apiKey,
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

interface Classification {
  arxivId: string;
  relationship: RelationshipType;
  reasoning: string;
  relevant: boolean;
  confidence?: number;
}

export interface RunPaperExploreOptions {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  model: Model;
  apiKey: string;
  signal?: AbortSignal;
  onProgress?: (phase: string) => void;
}

export interface RunPaperExploreResult {
  prerequisites: PrerequisitesData;
  graph: GraphData;
}

export async function runPaperExploreAnalysis(
  opts: RunPaperExploreOptions,
): Promise<RunPaperExploreResult> {
  const { reviewId, arxivId, paperTitle, paperContext, model, apiKey, signal, onProgress } =
    opts;

  const report = (s: string) => onProgress?.(s);

  // --- Phase 1 & 2: Run prerequisites + keyword extraction in parallel ---
  // These are independent LLM calls that both only need paper context,
  // so parallelizing saves one full round-trip (~3-8s).
  report("Identifying prerequisites & search keywords…");

  const prereqPrompt = `You are helping a researcher decide what to read before (or alongside) a paper. The full paper text is in your context.

Task: List 5–8 **recommended pre-reading topics** — concepts, techniques, or papers that would help the reader follow the core contributions (methods, assumptions, notation). These are suggestions, not hard requirements — for foundational papers some readers may already know these topics.

Rules:
- Topics must be specific (proper nouns, named methods, mathematical objects). Avoid vague topics like "machine learning basics" unless the paper truly assumes almost no background.
- "foundational" = undergraduate/core field standard; "intermediate" = typical PhD coursework; "advanced" = niche or research-frontier.
- Order loosely from foundational toward advanced as appropriate for *this* paper.
- Each description: 1–2 concise sentences stating why reading about this helps with *this* paper.

Return **only** valid JSON (no markdown fences, no commentary):
{"prerequisites":[{"topic":"…","description":"…","difficulty":"foundational|intermediate|advanced"}]}`;

  const keywordPrompt = `You will generate search phrases for arXiv (full paper text is in your context).

Output 5–8 short **search phrases** (not full boolean queries). Each phrase:
- 2–6 words, concrete technical vocabulary from *this* paper (method names, task, architecture, dataset domain).
- Vary specificity: mix precise terms with alternative names (synonyms, abbreviations).
- Avoid redundant near-duplicates; avoid useless generics ("neural networks", "deep learning") unless paired with a specific mechanism.
- Do NOT include AND/OR/quotes or field tags; the app will wrap them for arXiv.

Return **only** a JSON string array, e.g.:
["fault tolerant data parallelism", "ring allreduce distributed training"]

No markdown, no extra keys.`;

  // Keyword extraction works fine with a truncated paper context (saves tokens)
  const keywordPaperContext = truncateForPrompt(paperContext, 30_000);

  const [prereqRaw, keywordRaw] = await Promise.all([
    generateStructured(model, apiKey, prereqPrompt, paperContext, signal, { jsonOnly: true }),
    generateStructured(model, apiKey, keywordPrompt, keywordPaperContext, signal, { jsonOnly: true }),
  ]);

  // --- Parse prerequisites ---
  const parsedPrereqRaw = parseJson<{ prerequisites?: unknown; items?: unknown }>(
    prereqRaw,
    {},
  );
  const prereqList: Array<Omit<Prerequisite, "id">> = Array.isArray(
    parsedPrereqRaw.prerequisites,
  )
    ? (parsedPrereqRaw.prerequisites as Array<Omit<Prerequisite, "id">>)
    : Array.isArray(parsedPrereqRaw.items)
      ? (parsedPrereqRaw.items as Array<Omit<Prerequisite, "id">>)
      : [];
  const prevSnap = getPrerequisites(reviewId);
  const prevByTopic = new Map(
    (prevSnap?.prerequisites ?? []).map((p) => [prereqTopicKey(p.topic), p]),
  );
  const prerequisites: PrerequisitesData = {
    prerequisites: prereqList
      .filter(
        (item: Omit<Prerequisite, "id">) =>
          typeof item.topic === "string" &&
          item.topic.trim().length >= 3 &&
          typeof item.description === "string" &&
          item.description.trim().length >= 40,
      )
      .slice(0, 8)
      .map((item: Omit<Prerequisite, "id">) => {
        const t = item.topic.trim();
        const prior = prevByTopic.get(prereqTopicKey(t));
        return {
          id: crypto.randomUUID(),
          topic: t,
          description: item.description.trim(),
          difficulty: VALID_DIFFICULTIES.has(item.difficulty) ? item.difficulty : "intermediate",
          completedAt: prior?.completedAt,
          explanation: prior?.explanation,
        };
      }),
    generatedAt: new Date().toISOString(),
    modelUsed: model.label,
  };
  if (prerequisites.prerequisites.length === 0) {
    throw new Error("Could not parse prerequisites from model output. Try again or switch model.");
  }
  savePrerequisites(reviewId, prerequisites);

  // --- Parse keywords ---
  const parsedKeywords = parseJson<string[] | { queries?: string[] }>(keywordRaw, []);
  const rawList = Array.isArray(parsedKeywords)
    ? parsedKeywords
    : Array.isArray((parsedKeywords as { queries?: string[] }).queries)
      ? (parsedKeywords as { queries: string[] }).queries
      : [];
  const localKeywords = normalizeKeywordQueries(rawList);
  if (localKeywords.length === 0) {
    throw new Error("Could not parse search keywords from model output. Try again or switch model.");
  }

  // --- Phase 3: Search arXiv with parallel batched queries for better coverage ---
  report("Searching arXiv…");

  // Split keywords into batches and query in parallel for better coverage
  // and lower latency than a single monolithic OR query.
  const keywordBatches: string[][] = [];
  const BATCH_SIZE = 3;
  for (let i = 0; i < localKeywords.length; i += BATCH_SIZE) {
    keywordBatches.push(localKeywords.slice(i, i + BATCH_SIZE));
  }

  const resultsPerBatch = Math.min(12, Math.ceil(24 / keywordBatches.length));
  const batchFetches = keywordBatches.map((batch) => {
    const query = batch.map((k) => `all:${k}`).join(" OR ");
    return fetch(
      `/api/arxiv-search?query=${encodeURIComponent(query)}&max_results=${resultsPerBatch}`,
      { signal },
    ).then(async (res) => {
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to query arXiv.");
      }
      return ((await res.json()) as { results: ArxivSearchResult[] }).results;
    });
  });

  const batchResults = await Promise.all(batchFetches);

  // Deduplicate results across batches by arxivId
  const seenArxiv = new Set<string>();
  const allResults: ArxivSearchResult[] = [];
  for (const batch of batchResults) {
    for (const r of batch) {
      if (r.arxivId && !seenArxiv.has(r.arxivId)) {
        seenArxiv.add(r.arxivId);
        allResults.push(r);
      }
    }
  }

  const localCandidates = allResults
    .filter((c) => c.arxivId !== arxivId)
    .slice(0, 18);

  if (localCandidates.length === 0) {
    const graph: GraphData = {
      nodes: [
        {
          id: arxivId,
          title: paperTitle,
          authors: [],
          abstract: "No related candidates found for this query.",
          arxivId,
          publishedDate: new Date().toISOString(),
          categories: [],
          isCurrent: true,
        },
      ],
      edges: [],
      keywords: localKeywords,
      generatedAt: new Date().toISOString(),
      modelUsed: model.label,
      anchorReviewId: reviewId,
    };
    saveGraphData(reviewId, graph);
    mergeSessionGraphIntoGlobal(reviewId, graph);
    return { prerequisites, graph };
  }

  report("Classifying related papers…");
  const classifyPayload = localCandidates.map((c) => ({
    arxivId: c.arxivId,
    title: c.title,
    abstract: truncateForPrompt(c.abstract, 520),
    categories: c.categories.slice(0, 4),
  }));

  const classifyPrompt = `You classify how **candidate arXiv papers** relate to the **main paper** the user is reading.

Main paper title (for disambiguation only): ${JSON.stringify(paperTitle)}
Main arXiv id (exclude self): ${arxivId}

The full text of the main paper is in your context — use it to judge overlap with each candidate abstract below.

Relationship types (pick exactly one per candidate):
- "prerequisite": Candidate introduces ideas, notation, or results the main paper directly builds on; reading it first would clarify the main work.
- "builds-upon": Main paper extends, improves, or applies the candidate's specific method/problem setting (candidate is earlier/background).
- "extends": Candidate is later work that clearly extends the same approach as the main paper (less common in retrieval results).
- "similar-approach": Same core problem or algorithmic family; useful comparison or alternative pipeline.
- "contrasts-with": Meaningful opposing assumption, objective, or design choice vs the main paper (not merely different topic).
- "surveys": Survey, tutorial, or broad overview highly relevant to understanding the main paper's subfield.

Rules:
- Set relevant=false for off-topic hits, duplicates, or when the link is too weak to justify an edge.
- reasoning: one factual sentence referencing **concrete overlap** (method/task/dataset/claim), not generic praise.
- confidence: number 0–1 (calibrated: 0.9+ only with strong abstract evidence; 0.5–0.7 for plausible but uncertain).

Candidates (JSON):
${JSON.stringify(classifyPayload, null, 2)}

Return **only** a JSON array (no markdown):
[{"arxivId":"…","relationship":"…","reasoning":"…","relevant":true|false,"confidence":0.85}]`;

  const clsRaw = await generateStructured(model, apiKey, classifyPrompt, paperContext, signal, {
    jsonOnly: true,
  });
  const MIN_CONFIDENCE = 0.48;
  const parsedCls = parseJson<
    Classification[] | { classifications?: Classification[]; edges?: Classification[] }
  >(clsRaw, []);
  const parsedClassifications = Array.isArray(parsedCls)
    ? parsedCls
    : Array.isArray(parsedCls.classifications)
      ? parsedCls.classifications
      : Array.isArray(parsedCls.edges)
        ? parsedCls.edges
        : [];
  let classifications = parsedClassifications
    .filter((c) => c && typeof c.arxivId === "string")
    .filter((c) => c.relevant === true)
    .filter((c) => VALID_RELATIONSHIPS.has(c.relationship))
    .map((c) => ({
      ...c,
      confidence:
        typeof c.confidence === "number" && Number.isFinite(c.confidence)
          ? Math.min(1, Math.max(0, c.confidence))
          : 0.72,
    }))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  classifications = classifications.filter((c) => (c.confidence ?? 0) >= MIN_CONFIDENCE);

  if (classifications.length === 0) {
    const relaxed = parsedClassifications
      .filter((c) => c && typeof c.arxivId === "string")
      .filter((c) => c.relevant === true)
      .filter((c) => VALID_RELATIONSHIPS.has(c.relationship));
    if (relaxed.length > 0) {
      classifications = relaxed
        .map((c) => ({
          ...c,
          confidence:
            typeof c.confidence === "number" && Number.isFinite(c.confidence)
              ? Math.min(1, Math.max(0, c.confidence))
              : 0.55,
        }))
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        .slice(0, 8);
    }
  }

  // If no relationships survived filtering, return a minimal graph (just the current paper).
  // The user still gets their prerequisites; related papers may appear on re-analysis.
  if (classifications.length === 0) {
    const graph: GraphData = {
      nodes: [
        {
          id: arxivId,
          title: paperTitle,
          authors: [],
          abstract: "The paper currently being reviewed.",
          arxivId,
          publishedDate: new Date().toISOString(),
          categories: [],
          isCurrent: true,
        },
      ],
      edges: [],
      keywords: localKeywords,
      generatedAt: new Date().toISOString(),
      modelUsed: model.label,
      anchorReviewId: reviewId,
    };
    saveGraphData(reviewId, graph);
    mergeSessionGraphIntoGlobal(reviewId, graph);
    return { prerequisites, graph };
  }

  const currentNode: GraphNode = {
    id: arxivId,
    title: paperTitle,
    authors: [],
    abstract: "The paper currently being reviewed.",
    arxivId,
    publishedDate: new Date().toISOString(),
    categories: [],
    isCurrent: true,
  };

  const candidateById = new Map(localCandidates.map((item) => [item.arxivId, item]));
  const chosen = classifications
    .map((c) => {
      const item = candidateById.get(c.arxivId);
      if (!item) return null;
      return {
        cls: c,
        node: {
          id: item.arxivId,
          title: item.title,
          authors: item.authors,
          abstract: item.abstract,
          arxivId: item.arxivId,
          publishedDate: item.publishedDate,
          categories: item.categories,
          isCurrent: false,
        } as GraphNode,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .slice(0, 10);

  const graph: GraphData = {
    nodes: [currentNode, ...chosen.map((item) => item.node)],
    edges: chosen.map((item) => ({
      source: currentNode.id,
      target: item.node.id,
      relationship: item.cls.relationship,
      reasoning: item.cls.reasoning,
    })),
    keywords: localKeywords,
    generatedAt: new Date().toISOString(),
    modelUsed: model.label,
    anchorReviewId: reviewId,
  };
  saveGraphData(reviewId, graph);
  mergeSessionGraphIntoGlobal(reviewId, graph);

  return { prerequisites, graph };
}
