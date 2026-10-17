/**
 * Before/after eval for Discover: the current discover funnel vs. the reading
 * lists a previous run produced for the same questions.
 *
 * The funnel runs in-process through `runReadingAgent()`, exactly as
 * `/api/chat` runs it in discover mode, so the eval covers the real prompts,
 * tools, searches, and Jev screening. For each question we record the
 * reading list, overview, latency, and model tokens, then compare it with
 * the baseline run's list:
 *
 *   - Preference: a blind pairwise LLM judge (the configured Fireworks model)
 *     reads the question and both lists and picks the more useful one. It
 *     judges twice with the lists swapped to cancel position bias; split
 *     verdicts count as a tie.
 *   - Jev score: every final pick is scored by the Jev rubric on title and
 *     metadata only (no abstract, no rationale), a sanity check rather than
 *     a verdict, since the funnel optimizes for Jev.
 *
 * The baseline is a previous results folder: by default the most recent one.
 * Folders from the original agent-vs-funnel comparison hold two lists per
 * question; `--baseline-side` picks which (default "funnel"; "agent" is the
 * retired single-agent pipeline).
 *
 * Usage (needs FIREWORKS_API_KEY, FIREWORKS_MODEL, JEV_API_KEY, and
 * optionally EXA_API_KEY for web search, from the env or .env):
 *   npm run eval:discover_funnel                    # vs. the latest run
 *   npm run eval:discover_funnel -- --limit 2       # quick smoke test
 *   npm run eval:discover_funnel -- --baseline eval/discover_funnel/results/<dir>
 *   npm run eval:discover_funnel -- --no-persist    # JSON output only
 *   npm run eval:discover_funnel -- --persist-from eval/discover_funnel/results/<dir>
 *                                                   # save a finished run to the DB
 *
 * Results land in eval/discover_funnel/results/<timestamp>/ and, when
 * DATABASE_URL is set, in the Evals tab under "Discover: current vs
 * baseline". There, an item is CORRECT when the current list won the blind
 * preference, so a run's "accuracy" is its win rate over the baseline (ties
 * count as a win for neither).
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { mapConcurrent, writeJson, writeJsonl } from "../utils.ts";
import { createEvalPrisma } from "../db.ts";
import { EvalRunRecorder } from "../persistence.ts";
import { readingAgentRecipe } from "@/recipes/reading-agent";
import { JUDGE_DIMENSIONS } from "@/lib/judge-rubric";
import { runReadingAgent } from "@/server/reading-agent";
import { judgePicks } from "@/server/judge";
import {
  FIREWORKS_BASE_URL,
  getFireworksModel,
  getFireworksReasoningEffort,
} from "@/lib/fireworks";
import type { StreamEvent } from "@/lib/stream-types";

const RESULTS_DIR = join(import.meta.dirname, "results");

/** Representative Discover questions: foundational, engineering, recent,
 *  and narrow topics. */
const QUESTIONS = [
  "How have attention mechanisms evolved over time?",
  "What are the main approaches to making LLM inference faster?",
  "How do diffusion models work, and how are they used for video?",
  "What is the state of the art in retrieval-augmented generation evaluation?",
  "How do mixture-of-experts models route tokens, and what are the tradeoffs?",
  "What techniques make large-scale training deterministic and reproducible?",
  "How do state space models like Mamba compare to transformers?",
  "What are the best methods for choosing data mixtures for LLM pretraining?",
  "How does speculative decoding work and when does it help?",
  "What are the main approaches to mechanistic interpretability of transformers?",
];

interface Pick {
  title: string;
  url: string;
  rationale: string;
  arxivId?: string;
}

interface RunResult {
  picks: Pick[];
  overview: string;
  seconds: number;
  modelTokens: number;
  searches: number;
  graded: number | null;
  error: string | null;
  meanJev: number | null;
}

type Verdict = "current" | "baseline" | "tie";

interface Row {
  question: string;
  current: RunResult;
  /** The baseline's list for this question; null when it has none. */
  baseline: { picks: Pick[]; overview: string } | null;
  preferred: Verdict | null;
  preferenceReasons: string[];
}

/* ------------------------------------------------------------------ */
/*  Running the funnel                                                 */
/* ------------------------------------------------------------------ */

async function runDiscover(
  question: string,
  apiKey: string,
): Promise<Omit<RunResult, "meanJev">> {
  const started = Date.now();
  const events: StreamEvent[] = [];
  let error: string | null = null;
  try {
    await runReadingAgent({
      conversation: [{ role: "user", content: question }],
      apiKey,
      exaApiKey: process.env.EXA_API_KEY?.trim() || undefined,
      skipWebSearch: !process.env.EXA_API_KEY?.trim(),
      mode: "discover",
      discover: { question },
      emit: (e) => events.push(e),
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  let picks: Pick[] = [];
  let submitAt = -1;
  events.forEach((e, i) => {
    if (e.type === "tool_call" && e.name === "submit_picks") {
      const raw = e.input.picks;
      if (Array.isArray(raw)) {
        picks = raw.filter(
          (p): p is Pick =>
            !!p && typeof p === "object" && typeof p.url === "string" && typeof p.title === "string",
        );
        submitAt = i;
      }
    }
  });
  const overview =
    submitAt === -1
      ? ""
      : events
          .slice(submitAt + 1)
          .flatMap((e) => (e.type === "text_delta" ? [e.text] : []))
          .join("")
          .trim();
  const screen = events.find(
    (e): e is Extract<StreamEvent, { type: "tool_call" }> =>
      e.type === "tool_call" && e.name === "screen_sources",
  );

  return {
    picks,
    overview,
    seconds: (Date.now() - started) / 1000,
    modelTokens: events.reduce(
      (n, e) =>
        e.type === "cache_stats"
          ? n + e.inputTokens + e.cacheReadTokens + e.outputTokens
          : n,
      0,
    ),
    searches: events.filter(
      (e) =>
        e.type === "tool_call" &&
        (e.name === "arxiv_search" || e.name === "web_search"),
    ).length,
    graded: screen ? Number(screen.input.candidates) || 0 : null,
    error,
  };
}

/* ------------------------------------------------------------------ */
/*  Baseline                                                           */
/* ------------------------------------------------------------------ */

/** The newest results folder with at least one result. */
async function latestResultsDir(): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(RESULTS_DIR);
  } catch {
    return null;
  }
  for (const name of names.sort().reverse()) {
    const dir = join(RESULTS_DIR, name);
    try {
      if ((await stat(join(dir, "results.jsonl"))).size > 1) return dir;
    } catch {
      /* not a finished run */
    }
  }
  return null;
}

/** Each question's list from a previous run. Reads both this eval's rows
 *  (`current`) and the original agent-vs-funnel rows (`agent` / `funnel`). */
async function loadBaseline(
  dir: string,
  side: "agent" | "funnel",
): Promise<Map<string, { picks: Pick[]; overview: string }>> {
  const out = new Map<string, { picks: Pick[]; overview: string }>();
  const text = await readFile(join(dir, "results.jsonl"), "utf8");
  for (const line of text.split("\n").filter(Boolean)) {
    const row = JSON.parse(line) as Record<string, unknown> & { question: string };
    const list = (row.current ?? row[side]) as { picks?: Pick[]; overview?: string } | undefined;
    if (list?.picks) out.set(row.question, { picks: list.picks, overview: list.overview ?? "" });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Comparing                                                          */
/* ------------------------------------------------------------------ */

const PREFERENCE_PROMPT = `You compare two reading lists produced for the same research question. Judge which list better serves a technical reader trying to understand the topic: relevance to the question, coverage of its main threads, quality and importance of the sources, and no redundancy. Ignore formatting and the order of items. Respond with only JSON: {"winner": "A" | "B" | "tie", "reason": "<one sentence>"}`;

function formatList(picks: Pick[]): string {
  if (picks.length === 0) return "(empty: no reading list)";
  return picks
    .map((p, i) => `${i + 1}. ${p.title} (${p.url})\n   ${p.rationale}`)
    .join("\n");
}

async function prefer(
  apiKey: string,
  question: string,
  a: Pick[],
  b: Pick[],
): Promise<{ winner: "A" | "B" | "tie"; reason: string }> {
  const res = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getFireworksModel(),
      messages: [
        { role: "system", content: PREFERENCE_PROMPT },
        {
          role: "user",
          content: `Question: ${question}\n\nList A:\n${formatList(a)}\n\nList B:\n${formatList(b)}`,
        },
      ],
      stream: false,
      max_tokens: 2048,
      reasoning_effort: getFireworksReasoningEffort(),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Preference judge ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(match?.[0] ?? "") as { winner?: string; reason?: string };
    const winner = parsed.winner === "A" || parsed.winner === "B" ? parsed.winner : "tie";
    return { winner, reason: parsed.reason ?? "" };
  } catch {
    return { winner: "tie", reason: `Unparseable verdict: ${text.slice(0, 200)}` };
  }
}

/** Two judgments with the lists swapped. Agreement wins; a split is a tie. */
async function preference(
  apiKey: string,
  question: string,
  current: Pick[],
  baseline: Pick[],
): Promise<{ verdict: Verdict; reasons: string[] }> {
  const [first, second] = await Promise.all([
    prefer(apiKey, question, current, baseline),
    prefer(apiKey, question, baseline, current),
  ]);
  const v1: Verdict =
    first.winner === "tie" ? "tie" : first.winner === "A" ? "current" : "baseline";
  const v2: Verdict =
    second.winner === "tie" ? "tie" : second.winner === "A" ? "baseline" : "current";
  return { verdict: v1 === v2 ? v1 : "tie", reasons: [first.reason, second.reason] };
}

async function meanJev(question: string, picks: Pick[]): Promise<number | null> {
  if (picks.length === 0) return null;
  const results = await judgePicks(
    { question },
    picks.map((p) => ({ title: p.title, url: p.url, arxivId: p.arxivId ?? null })),
  );
  const scores = results.flatMap((r) => (r ? [r.score] : []));
  return scores.length > 0 ? scores.reduce((n, s) => n + s, 0) / scores.length : null;
}

/* ------------------------------------------------------------------ */
/*  Persisting to the Evals tab                                        */
/* ------------------------------------------------------------------ */

const BENCHMARK = {
  name: "Discover: current vs baseline",
  description:
    "Blind pairwise preference between the current discover funnel's reading " +
    "lists and a previous run's, on representative Discover questions. An item " +
    "is CORRECT when the current list won; accuracy is the win rate over the baseline.",
};

function itemKey(question: string): string {
  return createHash("sha256").update(question).digest("hex").slice(0, 16);
}

function describeList(list: { picks: Pick[]; overview: string }, error?: string | null): string {
  const picks = list.picks
    .map((p, i) => `${i + 1}. ${p.title}\n   ${p.url}\n   ${p.rationale}`)
    .join("\n\n");
  return [
    picks || "(no reading list)",
    list.overview ? `\nOverview:\n${list.overview}` : "",
    error ? `\nError: ${error}` : "",
  ].join("\n");
}

/** Save the run. Best-effort: a DB problem is logged, and the JSON output is
 *  the record of truth. */
async function persist(rows: Row[], source: string, baselineDir: string | null): Promise<void> {
  if (!(process.env.DATABASE_URL ?? process.env.DIRECT_URL)) {
    console.log("(persistence skipped: no DATABASE_URL)");
    return;
  }
  const prisma = createEvalPrisma();
  try {
    const recorder = await EvalRunRecorder.start(prisma, {
      benchmark: BENCHMARK,
      recipe: {
        name: "discover:funnel",
        description:
          "Wide search, Jev screening on content, LLM picks from the shortlist; ordered by Jev score.",
        metadata: {
          model: `funnel · ${process.env.FIREWORKS_MODEL ?? "unknown"}`,
          source,
          baseline: baselineDir,
          jevModel: process.env.JEV_MODEL ?? "jev-latest",
          judgeDimensions: JUDGE_DIMENSIONS,
          prompts: readingAgentRecipe.prompts,
        },
      },
    });
    for (const row of rows) {
      await recorder.recordItem({
        itemKey: itemKey(row.question),
        target: row.preferred ?? "no baseline",
        targetMetadata: { question: row.question },
        prediction: "current",
        predictionMetadata: {
          response: describeList(row.current, row.current.error),
          note: row.baseline
            ? `Judge: ${row.preferenceReasons.join(" | ")}\n\nBaseline list:\n${describeList(row.baseline)}`
            : "No baseline list for this question.",
          seconds: row.current.seconds,
          modelTokens: row.current.modelTokens,
          searches: row.current.searches,
          graded: row.current.graded,
          meanJev: row.current.meanJev,
        },
        predictionOutcome: row.current.error
          ? "ERROR"
          : row.preferred === "current"
            ? "CORRECT"
            : "INCORRECT",
      });
    }
    const mean = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.length ? v.reduce((n, x) => n + x, 0) / v.length : 0;
    };
    const share = (v: Verdict) =>
      rows.filter((r) => r.preferred === v).length / Math.max(1, rows.length);
    await recorder.complete([
      { metric: "win_rate", score: share("current") },
      { metric: "loss_rate", score: share("baseline") },
      { metric: "tie_rate", score: share("tie") },
      { metric: "mean_seconds", score: mean(rows.map((r) => r.current.seconds)) },
      { metric: "mean_model_tokens", score: mean(rows.map((r) => r.current.modelTokens)) },
      { metric: "mean_jev_metadata_only", score: mean(rows.map((r) => r.current.meanJev)) },
    ]);
    console.log(`Persisted run ${recorder.runId}`);
  } finally {
    await prisma.$disconnect();
  }
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      workers: { type: "string", default: "2" },
      baseline: { type: "string" },
      "baseline-side": { type: "string", default: "funnel" },
      "no-persist": { type: "boolean", default: false },
      "persist-from": { type: "string" },
    },
  });

  // Save an already-finished run's results without re-running anything.
  if (values["persist-from"]) {
    const dir = values["persist-from"];
    const text = await readFile(join(dir, "results.jsonl"), "utf8");
    const rows = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
    if (!rows.every((r) => r.current)) {
      throw new Error(
        `${dir} is from the original agent-vs-funnel comparison, which is already saved.`,
      );
    }
    const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8")) as {
      baseline?: string | null;
    };
    await persist(rows, dir, summary.baseline ?? null);
    return;
  }

  const apiKey = process.env.FIREWORKS_API_KEY?.trim();
  if (!apiKey) throw new Error("Set FIREWORKS_API_KEY (env or .env).");
  if (!process.env.JEV_API_KEY?.trim()) {
    throw new Error("Set JEV_API_KEY: the funnel and the Jev metric need it.");
  }
  const side = values["baseline-side"] === "agent" ? "agent" : "funnel";
  const baselineDir = values.baseline ?? (await latestResultsDir());
  const baseline = baselineDir ? await loadBaseline(baselineDir, side) : new Map();
  console.log(
    baselineDir
      ? `Baseline: ${baselineDir} (${baseline.size} lists)`
      : "No baseline found: recording lists without a preference comparison.",
  );

  const questions = QUESTIONS.slice(0, values.limit ? Number(values.limit) : undefined);
  const outDir = join(RESULTS_DIR, new Date().toISOString().replace(/[:.]/g, "-"));
  console.log(`Running ${questions.length} questions → ${outDir}`);

  const rows: Row[] = await mapConcurrent(
    questions,
    Number(values.workers) || 2,
    async (question) => {
      const run = await runDiscover(question, apiKey);
      const base = baseline.get(question) ?? null;
      const [pref, jev] = await Promise.all([
        base ? preference(apiKey, question, run.picks, base.picks) : Promise.resolve(null),
        meanJev(question, run.picks),
      ]);
      return {
        question,
        current: { ...run, meanJev: jev },
        baseline: base,
        preferred: pref?.verdict ?? null,
        preferenceReasons: pref?.reasons ?? [],
      };
    },
    (done, total) => console.log(`  ${done}/${total} questions`),
  );

  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length > 0 ? Number((v.reduce((n, x) => n + x, 0) / v.length).toFixed(3)) : null;
  };
  const summary = {
    questions: rows.length,
    baseline: baselineDir,
    baselineSide: side,
    preference: {
      current: rows.filter((r) => r.preferred === "current").length,
      baseline: rows.filter((r) => r.preferred === "baseline").length,
      tie: rows.filter((r) => r.preferred === "tie").length,
      notCompared: rows.filter((r) => r.preferred === null).length,
    },
    meanSeconds: mean(rows.map((r) => r.current.seconds)),
    meanModelTokens: mean(rows.map((r) => r.current.modelTokens)),
    meanSearches: mean(rows.map((r) => r.current.searches)),
    meanGraded: mean(rows.map((r) => r.current.graded)),
    meanPicks: mean(rows.map((r) => r.current.picks.length)),
    meanJev: mean(rows.map((r) => r.current.meanJev)),
    emptyLists: rows.filter((r) => r.current.picks.length === 0).length,
    errors: rows.filter((r) => r.current.error).length,
  };

  await writeJsonl(join(outDir, "results.jsonl"), rows);
  await writeJson(join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  if (!values["no-persist"]) await persist(rows, outDir, baselineDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
