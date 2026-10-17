/**
 * Before/after eval for Discover: the single discovery agent ("agent") vs.
 * the wide search + Jev screening funnel ("funnel").
 *
 * Both pipelines run in-process through `runReadingAgent()`, exactly as
 * `/api/chat` runs them in discover mode, so the comparison covers the real
 * prompts, tools, and searches. For each question we record each pipeline's
 * reading list, overview, latency, and model tokens, then compare the two:
 *
 *   - Preference: a blind pairwise LLM judge (the configured Fireworks model)
 *     reads the question and both lists and picks the more useful one. It
 *     judges twice with the lists swapped to cancel position bias; split
 *     verdicts count as a tie.
 *   - Jev score: every final pick in both lists is scored by the same Jev
 *     rubric on title and metadata only (no abstract, no rationale), so
 *     neither pipeline is graded on inputs only it had. The funnel already
 *     optimizes for Jev, so read this as a sanity check, not a verdict.
 *
 * Usage (needs FIREWORKS_API_KEY, FIREWORKS_MODEL, JEV_API_KEY, and
 * optionally EXA_API_KEY for web search, from the env or .env):
 *   npm run eval:discover_funnel                    # all questions
 *   npm run eval:discover_funnel -- --limit 2       # quick smoke test
 *   npm run eval:discover_funnel -- --workers 2
 *   npm run eval:discover_funnel -- --no-persist    # JSON output only
 *   npm run eval:discover_funnel -- --persist-from eval/discover_funnel/results/<dir>
 *                                                   # save a finished run to the DB
 *
 * Results land in eval/discover_funnel/results/<timestamp>/ and, when
 * DATABASE_URL is set, in the Evals tab: one run per pipeline under the
 * "Discover: agent vs funnel" benchmark. There, an item is CORRECT when that
 * pipeline's list won the blind preference, so a run's "accuracy" is its win
 * rate (ties count as a win for neither), and the compare view lines the two
 * pipelines up question by question.
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
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

/** Representative Discover questions: foundational, engineering, recent,
 *  and narrow topics, so neither pipeline is favored by question type. */
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

type Pipeline = "agent" | "funnel";

interface Pick {
  title: string;
  url: string;
  rationale: string;
  arxivId?: string;
}

interface RunResult {
  pipeline: Pipeline;
  picks: Pick[];
  overview: string;
  seconds: number;
  modelTokens: number;
  searches: number;
  graded: number | null;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/*  Running a pipeline                                                 */
/* ------------------------------------------------------------------ */

async function runPipeline(
  pipeline: Pipeline,
  question: string,
  apiKey: string,
): Promise<RunResult> {
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
      discover: { pipeline, question },
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
  const overview = events
    .slice(submitAt + 1)
    .flatMap((e) => (submitAt !== -1 && e.type === "text_delta" ? [e.text] : []))
    .join("")
    .trim();
  const modelTokens = events.reduce(
    (n, e) =>
      e.type === "cache_stats"
        ? n + e.inputTokens + e.cacheReadTokens + e.outputTokens
        : n,
    0,
  );
  const searches = events.filter(
    (e) =>
      e.type === "tool_call" &&
      (e.name === "arxiv_search" || e.name === "web_search"),
  ).length;
  const screen = events.find(
    (e): e is Extract<StreamEvent, { type: "tool_call" }> =>
      e.type === "tool_call" && e.name === "screen_sources",
  );

  return {
    pipeline,
    picks,
    overview,
    seconds: (Date.now() - started) / 1000,
    modelTokens,
    searches,
    graded: screen ? Number(screen.input.candidates) || 0 : null,
    error,
  };
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
  agent: Pick[],
  funnel: Pick[],
): Promise<{ verdict: Pipeline | "tie"; reasons: string[] }> {
  const [first, second] = await Promise.all([
    prefer(apiKey, question, agent, funnel),
    prefer(apiKey, question, funnel, agent),
  ]);
  const vote = (w: "A" | "B" | "tie", aIs: Pipeline): Pipeline | "tie" =>
    w === "tie" ? "tie" : w === "A" ? aIs : aIs === "agent" ? "funnel" : "agent";
  const v1 = vote(first.winner, "agent");
  const v2 = vote(second.winner, "funnel");
  return {
    verdict: v1 === v2 ? v1 : "tie",
    reasons: [first.reason, second.reason],
  };
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

type Row = {
  question: string;
  preferred: Pipeline | "tie";
  preferenceReasons: string[];
  agent: RunResult & { meanJev: number | null };
  funnel: RunResult & { meanJev: number | null };
};

const BENCHMARK = {
  name: "Discover: agent vs funnel",
  description:
    "Blind pairwise preference between the single discovery agent and the " +
    "wide-search + Jev screening funnel, on representative Discover questions. " +
    "An item is CORRECT when that pipeline's reading list won; accuracy is the win rate.",
};

const PIPELINE_DESCRIPTION: Record<Pipeline, string> = {
  agent: "Single discovery agent: searches, verifies, and picks on its own; agent order.",
  funnel:
    "Wide search, Jev screening on content, LLM picks from the shortlist; ordered by Jev score.",
};

function itemKey(question: string): string {
  return createHash("sha256").update(question).digest("hex").slice(0, 16);
}

function describeList(run: RunResult): string {
  const list = run.picks
    .map((p, i) => `${i + 1}. ${p.title}\n   ${p.url}\n   ${p.rationale}`)
    .join("\n\n");
  return [
    list || "(no reading list)",
    run.overview ? `\nOverview:\n${run.overview}` : "",
    run.error ? `\nError: ${run.error}` : "",
  ].join("\n");
}

/** Save both pipelines' runs. Best-effort: a DB problem is logged, and the
 *  JSON output is the record of truth. */
async function persist(rows: Row[], source: string): Promise<void> {
  if (!(process.env.DATABASE_URL ?? process.env.DIRECT_URL)) {
    console.log("(persistence skipped: no DATABASE_URL)");
    return;
  }
  const prisma = createEvalPrisma();
  try {
    for (const pipeline of ["agent", "funnel"] as const) {
      const recorder = await EvalRunRecorder.start(prisma, {
        benchmark: BENCHMARK,
        recipe: {
          name: `discover:${pipeline}`,
          description: PIPELINE_DESCRIPTION[pipeline],
          metadata: {
            model: `${pipeline} · ${process.env.FIREWORKS_MODEL ?? "unknown"}`,
            pipeline,
            source,
            jevModel: process.env.JEV_MODEL ?? "jev-latest",
            judgeDimensions: JUDGE_DIMENSIONS,
            prompts: readingAgentRecipe.prompts,
          },
        },
      });
      for (const row of rows) {
        const run = row[pipeline];
        await recorder.recordItem({
          itemKey: itemKey(row.question),
          target: row.preferred,
          targetMetadata: { question: row.question },
          prediction: pipeline,
          predictionMetadata: {
            response: describeList(run),
            note: `Judge: ${row.preferenceReasons.join(" | ")}`,
            seconds: run.seconds,
            modelTokens: run.modelTokens,
            searches: run.searches,
            graded: run.graded,
            meanJev: run.meanJev,
          },
          predictionOutcome: run.error
            ? "ERROR"
            : row.preferred === pipeline
              ? "CORRECT"
              : "INCORRECT",
        });
      }
      const mean = (xs: (number | null)[]) => {
        const v = xs.filter((x): x is number => x !== null);
        return v.length ? v.reduce((n, x) => n + x, 0) / v.length : 0;
      };
      await recorder.complete([
        {
          metric: "win_rate",
          score: rows.filter((r) => r.preferred === pipeline).length / Math.max(1, rows.length),
        },
        { metric: "tie_rate", score: rows.filter((r) => r.preferred === "tie").length / Math.max(1, rows.length) },
        { metric: "mean_seconds", score: mean(rows.map((r) => r[pipeline].seconds)) },
        { metric: "mean_model_tokens", score: mean(rows.map((r) => r[pipeline].modelTokens)) },
        { metric: "mean_jev_metadata_only", score: mean(rows.map((r) => r[pipeline].meanJev)) },
      ]);
      console.log(`Persisted ${pipeline} run ${recorder.runId}`);
    }
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
      "no-persist": { type: "boolean", default: false },
      "persist-from": { type: "string" },
    },
  });

  // Save an already-finished run's results without re-running anything.
  if (values["persist-from"]) {
    const dir = values["persist-from"];
    const rows = (await readFile(join(dir, "results.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Row);
    await persist(rows, dir);
    return;
  }

  const apiKey = process.env.FIREWORKS_API_KEY?.trim();
  if (!apiKey) throw new Error("Set FIREWORKS_API_KEY (env or .env).");
  if (!process.env.JEV_API_KEY?.trim()) {
    throw new Error("Set JEV_API_KEY: the funnel and the Jev metric need it.");
  }

  const questions = QUESTIONS.slice(0, values.limit ? Number(values.limit) : undefined);
  const outDir = join(
    import.meta.dirname,
    "results",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  console.log(`Running ${questions.length} questions × 2 pipelines → ${outDir}`);

  const rows = await mapConcurrent(
    questions,
    Number(values.workers) || 2,
    async (question) => {
      const [agent, funnel] = await Promise.all([
        runPipeline("agent", question, apiKey),
        runPipeline("funnel", question, apiKey),
      ]);
      const [pref, agentJev, funnelJev] = await Promise.all([
        preference(apiKey, question, agent.picks, funnel.picks),
        meanJev(question, agent.picks),
        meanJev(question, funnel.picks),
      ]);
      return {
        question,
        preferred: pref.verdict,
        preferenceReasons: pref.reasons,
        agent: { ...agent, meanJev: agentJev },
        funnel: { ...funnel, meanJev: funnelJev },
      };
    },
    (done, total) => console.log(`  ${done}/${total} questions`),
  );

  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length > 0 ? Number((v.reduce((n, x) => n + x, 0) / v.length).toFixed(3)) : null;
  };
  const side = (p: Pipeline) => ({
    meanSeconds: mean(rows.map((r) => r[p].seconds)),
    meanModelTokens: mean(rows.map((r) => r[p].modelTokens)),
    meanSearches: mean(rows.map((r) => r[p].searches)),
    meanPicks: mean(rows.map((r) => r[p].picks.length)),
    meanJev: mean(rows.map((r) => r[p].meanJev)),
    emptyLists: rows.filter((r) => r[p].picks.length === 0).length,
    errors: rows.filter((r) => r[p].error).length,
  });
  const summary = {
    questions: rows.length,
    preference: {
      funnel: rows.filter((r) => r.preferred === "funnel").length,
      agent: rows.filter((r) => r.preferred === "agent").length,
      tie: rows.filter((r) => r.preferred === "tie").length,
    },
    agent: side("agent"),
    funnel: { ...side("funnel"), meanGraded: mean(rows.map((r) => r.funnel.graded)) },
  };

  await writeJsonl(join(outDir, "results.jsonl"), rows);
  await writeJson(join(outDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  if (!values["no-persist"]) await persist(rows, outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
