/**
 * Client-side paper analysis pipeline (prerequisites).
 * Used by the Assistant learning tools; persists via explore storage helpers.
 */

import type { Model } from "@/lib/models";
import type { Prerequisite, PrerequisitesData } from "@/lib/explore";
import { loadExplore, savePrerequisites } from "@/lib/client-data";

const VALID_DIFFICULTIES = new Set(["foundational", "intermediate", "advanced"]);

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

function prereqTopicKey(topic: string): string {
  return topic.toLowerCase().replace(/\s+/g, " ").trim();
}

async function generateStructured(
  model: Model,
  apiKey: string,
  apiBaseUrl: string | undefined,
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
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
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

export interface RunPaperExploreOptions {
  reviewId: string;
  paperTitle: string;
  paperContext: string;
  model: Model;
  apiKey: string;
  /** Base URL for OpenAI-compatible providers. */
  apiBaseUrl?: string;
  signal?: AbortSignal;
  onProgress?: (phase: string) => void;
}

export interface RunPaperExploreResult {
  prerequisites: PrerequisitesData;
}

export async function runPaperExploreAnalysis(
  opts: RunPaperExploreOptions,
): Promise<RunPaperExploreResult> {
  const {
    reviewId,
    paperContext,
    model,
    apiKey,
    apiBaseUrl,
    signal,
    onProgress,
  } = opts;

  const report = (s: string) => onProgress?.(s);

  report("Finding recommended pre-reading…");
  const prereqPrompt = `You are helping a researcher decide what to read before (or alongside) a paper. The full paper text is in your context.

Task: List 5–8 **recommended pre-reading topics** — concepts, techniques, or papers that would help the reader follow the core contributions (methods, assumptions, notation). These are suggestions, not hard requirements — for foundational papers some readers may already know these topics.

Rules:
- Topics must be specific (proper nouns, named methods, mathematical objects). Avoid vague topics like "machine learning basics" unless the paper truly assumes almost no background.
- "foundational" = undergraduate/core field standard; "intermediate" = typical PhD coursework; "advanced" = niche or research-frontier.
- Order loosely from foundational toward advanced as appropriate for *this* paper.
- Each description: 1–2 concise sentences stating why reading about this helps with *this* paper.

Return **only** valid JSON (no markdown fences, no commentary):
{"prerequisites":[{"topic":"…","description":"…","difficulty":"foundational|intermediate|advanced"}]}`;
  const prereqRaw = await generateStructured(model, apiKey, apiBaseUrl, prereqPrompt, paperContext, signal, {
    jsonOnly: true,
  });
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
  const prevSnap = (await loadExplore(reviewId)).prerequisites;
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
  await savePrerequisites(reviewId, prerequisites);

  return { prerequisites };
}
