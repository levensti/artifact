/**
 * Run the ELAIPBench eval against Artifact's full reading agent.
 *
 * ELAIPBench (https://huggingface.co/datasets/KangKang625/ELAIPBench) is 403
 * expert-written multiple-choice questions over 137 AI papers. Each row is
 * self-contained: it ships the full `paper_content` and embeds the A-D options
 * inside the `question` string. Scoring is exact-match on the chosen option
 * letter(s) — single-answer (SA-MCQ) and multi-answer (MA-MCQ, e.g. "ABC"),
 * with no partial credit (the dataset's own protocol).
 *
 * We feed `paper_content` as Artifact's `paperContext` and send only the
 * question + answer-format instruction as the prompt, then run the SAME agentic
 * loop the `/api/chat` reading surface runs — tools included — via
 * `runReadingAgent()` in-process (see ReadingAgentClient in utils.ts). So the
 * run measures the whole harness a user talks to, not a reimplementation, with
 * no dev server, auth, or rate limiter in the loop — just an OpenRouter key.
 * (Note: the agent may call `arxiv_search` / `web_search` mid-answer, so a full
 * run makes real network calls beyond the model itself.)
 *
 * Usage:
 *   npm run eval:elaip_bench -- --api-key sk-or-...     # or set OPENROUTER_API_KEY
 *   npm run eval:elaip_bench -- --limit 20 --workers 4  # quick smoke test
 *
 * Reference points from the ELAIPBench paper: best LLM 39.95%, human 48.14%.
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ReadingAgentClient,
  type EvalClient,
  loadHfJsonl,
  mapConcurrent,
  parseChoiceLetters,
  parseGold,
  scoreExact,
  lettersToString,
  writeJson,
  writeJsonl,
} from "../utils.ts";
import { createEvalPrisma } from "../db.ts";
import {
  EvalRunRecorder,
  outcomeFor,
  type PersistItem,
  type PersistMetric,
} from "../persistence.ts";
import { OPENROUTER_MODEL } from "@/lib/openrouter";
import { readingAgentRecipe } from "@/recipes/reading-agent";

const DATASET = "KangKang625/ELAIPBench";
const DATA_FILE = "elabench.jsonl";
const DATASET_REVISION = "main";

interface ElaipBenchRow {
  paper_id?: string;
  question_type?: string;
  question: string;
  answer: string;
  paper_content?: string;
}

interface RowResult {
  paper_id?: string;
  question_type: string;
  gold: string;
  pred: string;
  correct: boolean;
  unparsed: boolean;
  api_ok: boolean;
  note?: string;
  response: string;
}

/**
 * Question text (options already embedded) + an answer-format contract. The
 * boxed-letter instruction is what `parseChoiceLetters` keys off. SA vs MA is
 * kept explicit so the model knows whether to pick one or several — exactly the
 * distinction the dataset scores on.
 */
function buildPrompt(question: string, questionType: string): string {
  const rule =
    questionType === "MA-MCQ"
      ? "This question may have MORE THAN ONE correct option. Select ALL correct " +
        "options. End your reply with \\boxed{LETTERS} using every correct letter " +
        "in alphabetical order, e.g. \\boxed{ACD}."
      : "This question has EXACTLY ONE correct option. End your reply with " +
        "\\boxed{LETTER}, e.g. \\boxed{B}.";
  return (
    "Answer the following multiple-choice question about the paper above.\n\n" +
    `${question.trim()}\n\n${rule}`
  );
}

async function evaluate(
  rows: ElaipBenchRow[],
  client: EvalClient,
  workers: number,
  onResult?: (result: RowResult, row: ElaipBenchRow, index: number) => Promise<void>,
): Promise<RowResult[]> {
  return mapConcurrent(
    rows,
    workers,
    async (row, index): Promise<RowResult> => {
      const questionType = row.question_type ?? "SA-MCQ";
      const prompt = buildPrompt(row.question, questionType);
      const res = await client.generate(prompt, row.paper_content);
      const pred = parseChoiceLetters(res.content);
      const gold = parseGold(row.answer);
      const result: RowResult = {
        paper_id: row.paper_id,
        question_type: questionType,
        gold: lettersToString(gold),
        pred: lettersToString(pred),
        correct: scoreExact(pred, gold),
        unparsed: pred.size === 0,
        api_ok: res.ok,
        note: res.error,
        response: res.content,
      };
      // Persist this question as soon as it finishes (incremental write).
      if (onResult) await onResult(result, row, index);
      return result;
    },
    (done, total) => process.stdout.write(`\r  ${done}/${total} done`),
  );
}

/**
 * Stable per-question identity for cross-run comparison: the paper id plus a
 * short hash of the question text, so it survives reordering and `--limit`
 * (a bare row index would not).
 */
function itemKeyFor(row: ElaipBenchRow): string {
  const hash = createHash("sha1").update(row.question).digest("hex").slice(0, 12);
  return `${row.paper_id ?? "unknown"}:${hash}`;
}

/** Map a scored row to the DB item shape (raw response + note kept for audit). */
function toPersistItem(result: RowResult, row: ElaipBenchRow): PersistItem {
  return {
    itemKey: itemKeyFor(row),
    target: result.gold,
    targetMetadata: {
      question_type: result.question_type,
      paper_id: result.paper_id ?? null,
      question: row.question,
    },
    prediction: result.pred,
    predictionMetadata: { response: result.response, note: result.note ?? null },
    predictionOutcome: outcomeFor(result.api_ok, result.unparsed, result.correct),
  };
}

/** Overall + per-question-type accuracy as one metric row each. */
function toMetrics(summary: ReturnType<typeof summarize>): PersistMetric[] {
  const metrics: PersistMetric[] = [
    { metric: "accuracy", score: summary.overall.accuracy, breakdown: summary.overall },
  ];
  for (const [type, bucket] of Object.entries(summary.by_question_type)) {
    metrics.push({
      metric: `accuracy:${type}`,
      score: bucket.accuracy,
      breakdown: bucket,
    });
  }
  return metrics;
}

interface Bucket {
  n: number;
  correct: number;
  accuracy: number;
  unparsed: number;
  api_errors: number;
}

function bucket(rs: RowResult[]): Bucket {
  const n = rs.length;
  const correct = rs.filter((r) => r.correct).length;
  return {
    n,
    correct,
    accuracy: n ? Number((correct / n).toFixed(4)) : 0,
    unparsed: rs.filter((r) => r.unparsed).length,
    api_errors: rs.filter((r) => !r.api_ok).length,
  };
}

/**
 * Overall accuracy plus a breakdown by question_type (SA-MCQ / MA-MCQ). The
 * dataset has no difficulty field, so type is the only built-in slice. Parse
 * failures and API errors are surfaced so a low score can't quietly hide a
 * broken harness or an unreachable server.
 */
function summarize(results: RowResult[]) {
  const byType: Record<string, RowResult[]> = {};
  for (const r of results) (byType[r.question_type] ??= []).push(r);
  const by_question_type: Record<string, Bucket> = {};
  for (const t of Object.keys(byType).sort()) by_question_type[t] = bucket(byType[t]);
  return { dataset: DATASET, overall: bucket(results), by_question_type };
}

function printSummary(s: ReturnType<typeof summarize>): void {
  const o = s.overall;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log("\n" + "=".repeat(52));
  console.log(`  ELAIPBench  (${o.n} questions)`);
  console.log("=".repeat(52));
  console.log(`  Overall accuracy : ${pct(o.accuracy)}  (${o.correct}/${o.n})`);
  for (const [t, b] of Object.entries(s.by_question_type)) {
    console.log(`    ${t.padEnd(8)}       : ${pct(b.accuracy)}  (${b.correct}/${b.n})`);
  }
  if (o.unparsed || o.api_errors) {
    console.log(
      `  ! unparsed=${o.unparsed}  api_errors=${o.api_errors}  (inspect results.jsonl)`,
    );
  }
  console.log("  ref: best LLM 39.95% / human 48.14% (ELAIPBench paper)");
  console.log("=".repeat(52));
}

/**
 * When the run is dominated by API errors, the score is meaningless — surface
 * the likely cause instead of a misleading 0%. Errors now come straight from
 * OpenRouter (the harness calls `generate()` directly), so the usual suspects
 * are a missing/invalid key or provider throttling.
 */
function printErrorHints(results: RowResult[]): void {
  const errors = results.filter((r) => !r.api_ok);
  if (errors.length === 0) return;
  const sample = errors[0].note ?? "";
  console.log(`\n${errors.length}/${results.length} requests failed calling OpenRouter.`);
  if (sample.includes("No OpenRouter key") || sample.includes("401")) {
    console.log(
      "  -> missing or invalid key. Pass --api-key sk-or-... or set\n" +
        "     OPENROUTER_API_KEY, and check the key has credit.\n",
    );
  } else if (sample.includes("429")) {
    console.log("  -> 429: OpenRouter throttled. Lower --workers and retry.\n");
  } else {
    console.log(`  -> first error: ${sample}\n`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "api-key": { type: "string" },
      limit: { type: "string" },
      workers: { type: "string", default: "8" },
      out: { type: "string", default: join(import.meta.dirname, "results") },
      "no-persist": { type: "boolean", default: false },
    },
  });

  const limit = values.limit ? Number(values.limit) : undefined;
  const workers = Number(values.workers);

  console.log(`Loading ${DATASET} ...`);
  const rows = (await loadHfJsonl(DATASET, DATA_FILE, {
    revision: DATASET_REVISION,
    limit,
  })) as unknown as ElaipBenchRow[];
  console.log(`Loaded ${rows.length} questions. Running the reading agent with ${workers} workers.`);

  // Open a DB-backed run unless --no-persist (or there's no DATABASE_URL). The
  // recipe captured is the reading agent's, since that's the system under test;
  // its metadata pins the model + prompts so the run is reproducible.
  const { prisma, recorder } = await maybeStartRun(values["no-persist"]);
  if (recorder) console.log(`Persisting to eval run ${recorder.runId}`);

  const client = new ReadingAgentClient({ apiKey: values["api-key"] });
  const onResult = recorder
    ? (result: RowResult, row: ElaipBenchRow) =>
        recorder.recordItem(toPersistItem(result, row))
    : undefined;

  try {
    const results = await evaluate(rows, client, workers, onResult);
    const summary = summarize(results);

    const outDir = values.out!;
    await writeJsonl(join(outDir, "results.jsonl"), results);
    await writeJson(join(outDir, "summary.json"), summary);
    printSummary(summary);
    printErrorHints(results);
    console.log(`\nWrote ${join(outDir, "results.jsonl")} and ${join(outDir, "summary.json")}`);

    if (recorder) {
      await recorder.complete(toMetrics(summary));
      console.log(`Persisted run ${recorder.runId} (status COMPLETED).`);
    }
  } catch (err) {
    if (recorder) await recorder.fail();
    throw err;
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

/**
 * Start a DB-backed run, or return empty handles when persistence is off or
 * unavailable. Never throws: a missing DATABASE_URL or a DB that's down logs a
 * note and the eval proceeds writing only its JSON output.
 */
async function maybeStartRun(noPersist: boolean | undefined) {
  if (noPersist) return { prisma: null, recorder: null };
  if (!(process.env.DATABASE_URL ?? process.env.DIRECT_URL)) {
    console.log("(persistence skipped: no DATABASE_URL; pass --no-persist to silence)");
    return { prisma: null, recorder: null };
  }
  const prisma = createEvalPrisma();
  try {
    const recorder = await EvalRunRecorder.start(prisma, {
      benchmark: {
        name: "ELAIPBench",
        description:
          "403 expert-written multiple-choice questions over 137 AI papers; " +
          "exact-match scoring, no partial credit.",
      },
      recipe: {
        name: readingAgentRecipe.name,
        description: readingAgentRecipe.description,
        metadata: {
          model: OPENROUTER_MODEL,
          source: "src/recipes/reading-agent.ts",
          prompts: readingAgentRecipe.prompts,
        },
      },
    });
    return { prisma, recorder };
  } catch (err) {
    console.error(
      `(persistence disabled: ${err instanceof Error ? err.message : err}); continuing without DB`,
    );
    await prisma.$disconnect();
    return { prisma: null, recorder: null };
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
