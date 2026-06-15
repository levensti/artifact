/**
 * Run the ELAIPBench eval against Artifact's generate() entrypoint.
 *
 * ELAIPBench (https://huggingface.co/datasets/KangKang625/ELAIPBench) is 403
 * expert-written multiple-choice questions over 137 AI papers. Each row is
 * self-contained: it ships the full `paper_content` and embeds the A-D options
 * inside the `question` string. Scoring is exact-match on the chosen option
 * letter(s) — single-answer (SA-MCQ) and multi-answer (MA-MCQ, e.g. "ABC"),
 * with no partial credit (the dataset's own protocol).
 *
 * We feed `paper_content` as Artifact's `paperContext` and send only the
 * question + answer-format instruction as the prompt, so the run measures
 * Artifact's actual prompt/paper wrapping rather than a reimplementation. The
 * harness calls the app's `generate()` entrypoint in-process (see utils.ts), so
 * there's no dev server, auth, or rate limiter in the loop — just an OpenRouter
 * key.
 *
 * Usage:
 *   npm run eval:elaip -- --api-key sk-or-...        # or set OPENROUTER_API_KEY
 *   npm run eval:elaip -- --limit 20 --workers 4     # quick smoke test
 *
 * Reference points from the ELAIPBench paper: best LLM 39.95%, human 48.14%.
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import {
  GenerateClient,
  loadHfJsonl,
  mapConcurrent,
  parseChoiceLetters,
  parseGold,
  scoreExact,
  lettersToString,
  writeJson,
  writeJsonl,
} from "../utils.ts";

const DATASET = "KangKang625/ELAIPBench";
const DATA_FILE = "elabench.jsonl";

/**
 * tsx, unlike the Next dev server, does not auto-load `.env`. The app keeps its
 * OpenRouter key there, so load the repo-root `.env` as a fallback to keep the
 * same ergonomics. Explicit shell env and `--api-key` still win: we only fill
 * the key when nothing already set it, and never clobber an existing value.
 */
function loadDotenvFallback(): void {
  if (process.env.OPENROUTER_API_KEY) return;
  const proc = process as typeof process & { loadEnvFile?: (path?: string) => void };
  if (typeof proc.loadEnvFile !== "function") return;
  try {
    proc.loadEnvFile(join(import.meta.dirname, "..", "..", ".env"));
  } catch {
    /* no .env present — rely on real env / --api-key */
  }
}

interface ElaipRow {
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
  rows: ElaipRow[],
  client: GenerateClient,
  workers: number,
): Promise<RowResult[]> {
  return mapConcurrent(
    rows,
    workers,
    async (row): Promise<RowResult> => {
      const questionType = row.question_type ?? "SA-MCQ";
      const prompt = buildPrompt(row.question, questionType);
      const res = await client.generate(prompt, row.paper_content);
      const pred = parseChoiceLetters(res.content);
      const gold = parseGold(row.answer);
      return {
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
    },
    (done, total) => process.stdout.write(`\r  ${done}/${total} done`),
  );
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
    },
  });

  loadDotenvFallback();

  const limit = values.limit ? Number(values.limit) : undefined;
  const workers = Number(values.workers);

  console.log(`Loading ${DATASET} ...`);
  const rows = (await loadHfJsonl(DATASET, DATA_FILE, { limit })) as unknown as ElaipRow[];
  console.log(`Loaded ${rows.length} questions. Calling generate() with ${workers} workers.`);

  const client = new GenerateClient({ apiKey: values["api-key"] });
  const results = await evaluate(rows, client, workers);
  const summary = summarize(results);

  const outDir = values.out!;
  await writeJsonl(join(outDir, "results.jsonl"), results);
  await writeJson(join(outDir, "summary.json"), summary);
  printSummary(summary);
  printErrorHints(results);
  console.log(`\nWrote ${join(outDir, "results.jsonl")} and ${join(outDir, "summary.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
