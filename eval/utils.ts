/**
 * Shared utilities for Artifact eval harnesses.
 *
 * Every eval under `eval/<name>/` reuses three things from here:
 *
 *   1. An in-process client over one of the app's real agent entrypoints. The
 *      eval calls the entrypoint DIRECTLY, so it exercises Artifact's actual
 *      prompt + paper wrapping with nothing re-implemented and nothing to
 *      drift — but WITHOUT the HTTP route's proxy auth, session, and per-user
 *      rate-limit metering, none of which is part of the agent. Two clients,
 *      same `generate(prompt, paperContext)` contract (see {@link EvalClient}):
 *        - `ReadingAgentClient` — the FULL agentic harness `runReadingAgent()`
 *          (`src/server/reading-agent.ts`): the tool-using ReAct loop a user
 *          actually talks to. This is what evaluates the whole harness.
 *        - `GenerateClient` — the bare `generate()` entrypoint (no tools), for
 *          measuring just the model + prompt without the agent loop.
 *      All either needs is an OpenRouter key (`--api-key` or
 *      `OPENROUTER_API_KEY`); no dev server, no login.
 *
 *   2. Multiple-choice answer parsing/scoring — turning free-form model text
 *      into a set of option letters and exact-matching it against a gold set.
 *
 *   3. A Hugging Face dataset loader, a promise pool, and small IO helpers
 *      shared by every runner.
 *
 * Pure Node built-ins (fetch, fs) plus the app's own agent code — no
 * third-party runtime deps.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generate } from "@/server/generate";
import { runReadingAgent } from "@/server/reading-agent";
import {
  processStreamEvent,
  stepsToContent,
  type AgentStep,
} from "@/lib/agent-steps";
import type { StreamEvent } from "@/lib/stream-types";

// --------------------------------------------------------------------------- //
//  Config                                                                      //
// --------------------------------------------------------------------------- //

/**
 * Cap on paper size (chars) we feed the model, mirroring the route's 413 limit.
 * The dataset's papers are well under this; the guard just keeps a pathological
 * row from blowing the model's context window.
 */
export const PAPER_CONTEXT_HARD_LIMIT = 500_000;

// --------------------------------------------------------------------------- //
//  In-process agent clients                                                    //
// --------------------------------------------------------------------------- //

export interface GenerateResult {
  content: string;
  ok: boolean;
  /** Non-fatal note (e.g. paper truncated) or the error when `ok` is false. */
  error?: string;
}

export interface GenerateClientOptions {
  apiKey?: string | null;
  maxRetries?: number;
  maxPaperChars?: number;
}

/**
 * The contract a runner targets: take a prompt + optional paper context and
 * return the model's text (or an error). Both clients implement it, so a runner
 * can switch between the full agent and the bare model with one line.
 */
export interface EvalClient {
  generate(prompt: string, paperContext?: string): Promise<GenerateResult>;
}

/** Error messages worth retrying: transient provider/network conditions. */
const TRANSIENT_RE =
  /\b429\b|rate.?limit|timeout|temporar|overloaded|\b50[0-9]\b|fetch failed|network|ECONN/i;

/** 1s, 2s, 4s, 8s ... capped at 30s. */
function backoff(attempt: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.min(2 ** attempt, 30) * 1000));
}

/**
 * Paper-context truncation + transient-error retry, shared by both clients.
 * `call` performs the actual in-process model invocation and returns the
 * response text; it receives the resolved key and the (possibly truncated)
 * paper context. Transient failures (timeouts, 429, 5xx) retry with
 * exponential backoff; other errors (e.g. a bad key) fail fast.
 */
async function runWithRetry(
  apiKey: string | null,
  paperContext: string | undefined,
  maxPaperChars: number,
  maxRetries: number,
  call: (apiKey: string, paperContext?: string) => Promise<string>,
): Promise<GenerateResult> {
  if (!apiKey) {
    return {
      content: "",
      ok: false,
      error: "No OpenRouter key. Pass --api-key or set OPENROUTER_API_KEY.",
    };
  }

  let truncated = false;
  if (paperContext && paperContext.length > maxPaperChars) {
    paperContext = paperContext.slice(0, maxPaperChars);
    truncated = true;
  }

  let lastErr = "unknown error";
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const content = await call(apiKey, paperContext);
      return {
        content,
        ok: true,
        error: truncated ? "paper truncated to fit model context" : undefined,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (TRANSIENT_RE.test(lastErr) && attempt < maxRetries - 1) {
        await backoff(attempt);
        continue;
      }
      return { content: "", ok: false, error: lastErr };
    }
  }

  return { content: "", ok: false, error: `giving up after retries: ${lastErr}` };
}

/**
 * Drives the FULL agentic reading harness — `runReadingAgent()`, the same
 * tool-using ReAct loop the `/api/chat` route runs — in-process. The paper text
 * is fed as `paperContext` (so the agent works off the full source, no
 * `parsedPaper` → the paper-internal tools self-disable) and the answer is the
 * concatenated text the agent produced, assembled with the exact same
 * `stepsToContent` logic the app persists and renders.
 *
 * The agent's `arxiv_search` / `web_search` tools stay registered, matching a
 * real reading session: the model MAY hit the network mid-answer, and with no
 * Exa key `web_search` returns its configure-key sentinel (same as a user
 * without a key). That is part of the harness being measured.
 */
export class ReadingAgentClient implements EvalClient {
  private readonly apiKey: string | null;
  private readonly maxRetries: number;
  private readonly maxPaperChars: number;

  constructor(opts: GenerateClientOptions = {}) {
    this.apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY || null;
    this.maxRetries = opts.maxRetries ?? 4;
    this.maxPaperChars = opts.maxPaperChars ?? PAPER_CONTEXT_HARD_LIMIT - 1;
  }

  generate(prompt: string, paperContext?: string): Promise<GenerateResult> {
    return runWithRetry(
      this.apiKey,
      paperContext,
      this.maxPaperChars,
      this.maxRetries,
      async (apiKey, paper) => {
        let steps: AgentStep[] = [];
        let errorMessage: string | null = null;
        const emit = (event: StreamEvent) => {
          steps = processStreamEvent(steps, event);
          // The loop usually THROWS provider errors (caught by runWithRetry),
          // but guard against an emitted error event too so a failed turn never
          // scores as an empty (wrong) answer.
          if (event.type === "error") errorMessage = event.message ?? "agent error";
        };
        await runReadingAgent({
          conversation: [{ role: "user", content: prompt }],
          apiKey,
          paperContext: paper,
          emit,
        });
        if (errorMessage) throw new Error(errorMessage);
        return stepsToContent(steps);
      },
    );
  }
}

/**
 * Drives the bare `generate()` entrypoint (no tools, no loop) in-process — for
 * measuring just the model + prompt + paper wrapping, without the agent.
 */
export class GenerateClient implements EvalClient {
  private readonly apiKey: string | null;
  private readonly maxRetries: number;
  private readonly maxPaperChars: number;

  constructor(opts: GenerateClientOptions = {}) {
    this.apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY || null;
    this.maxRetries = opts.maxRetries ?? 4;
    this.maxPaperChars = opts.maxPaperChars ?? PAPER_CONTEXT_HARD_LIMIT - 1;
  }

  generate(prompt: string, paperContext?: string): Promise<GenerateResult> {
    return runWithRetry(
      this.apiKey,
      paperContext,
      this.maxPaperChars,
      this.maxRetries,
      async (apiKey, paper) => (await generate(apiKey, prompt, paper)).content,
    );
  }
}

// --------------------------------------------------------------------------- //
//  Multiple-choice answer parsing + scoring                                    //
// --------------------------------------------------------------------------- //

// Match \boxed{...} or boxed{...} (model may or may not emit the backslash).
const BOXED_RE = /\\?boxed\s*\{([^}]*)\}/gi;
// Fallback: "the (correct )?answer(s) is/are: A, C" style phrase.
const ANSWER_PHRASE_RE =
  /answers?\b[^A-Za-z]{0,12}(?:is|are|:)\s*([A-Da-d](?:\s*[,/and ]*\s*[A-Da-d])*)/gi;

const VALID_LETTERS = new Set(["A", "B", "C", "D"]);

/**
 * Extract the chosen option letters from a model response.
 *
 * Resolution order, most reliable first:
 *   1. The contents of the LAST `\boxed{...}` (the format we instruct).
 *   2. An "answer is X" style phrase.
 * Only A-D are kept, case-folded. Returns an empty set when nothing parses,
 * which scores as wrong (and is flagged in the per-row output for inspection).
 */
export function parseChoiceLetters(text: string): Set<string> {
  const boxed = [...text.matchAll(BOXED_RE)];
  if (boxed.length > 0) {
    const letters = lettersIn(boxed[boxed.length - 1][1]);
    if (letters.size > 0) return letters;
  }
  const phrases = [...text.matchAll(ANSWER_PHRASE_RE)];
  if (phrases.length > 0) {
    const letters = lettersIn(phrases[phrases.length - 1][1]);
    if (letters.size > 0) return letters;
  }
  return new Set();
}

function lettersIn(blob: string): Set<string> {
  const out = new Set<string>();
  for (const ch of blob.toUpperCase()) {
    if (VALID_LETTERS.has(ch)) out.add(ch);
  }
  return out;
}

/** Normalize a dataset `answer` field (e.g. "B" or "ABC") to a letter set. */
export function parseGold(answer: string): Set<string> {
  return lettersIn(answer);
}

/**
 * ELAIPBench scoring: exact set match, no partial credit. A multi-answer
 * response with any extra or missing letter scores zero.
 */
export function scoreExact(pred: Set<string>, gold: Set<string>): boolean {
  if (gold.size === 0 || pred.size !== gold.size) return false;
  for (const g of gold) if (!pred.has(g)) return false;
  return true;
}

/** Stable, sorted string form of a letter set, for logging ("AC", "B", ""). */
export function lettersToString(s: Set<string>): string {
  return [...s].sort().join("");
}

// --------------------------------------------------------------------------- //
//  Hugging Face dataset loader                                                  //
// --------------------------------------------------------------------------- //

/**
 * Load a `.jsonl` file straight from a public HF dataset repo
 * (`resolve/main/<file>`) and parse it line by line. We fetch the raw file
 * rather than the datasets-server `/rows` API because that API's on-the-fly
 * Parquet conversion 500s on some datasets (ELAIPBench among them); the raw
 * file is always there and has no encoding surprises. Pass `limit` to stop
 * early for a quick smoke test.
 */
export async function loadHfJsonl(
  dataset: string,
  file: string,
  opts: { revision?: string; limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  const revision = opts.revision ?? "main";
  const url = `https://huggingface.co/datasets/${dataset}/resolve/${revision}/${file}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HF fetch ${resp.status} for ${url}: ${(await resp.text()).slice(0, 200)}`);
  }
  const text = await resp.text();
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed) as Record<string, unknown>);
    if (opts.limit != null && rows.length >= opts.limit) break;
  }
  return rows;
}

// --------------------------------------------------------------------------- //
//  Concurrency + IO helpers                                                     //
// --------------------------------------------------------------------------- //

/**
 * Run `fn` over `items` with at most `workers` in flight, returning results IN
 * ORDER. `onDone(completed, total)` fires after each item for progress display.
 * `fn` should be total (catch its own errors) so one failure can't reject all.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  workers: number,
  fn: (item: T, index: number) => Promise<R>,
  onDone?: (completed: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let completed = 0;
  const total = items.length;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= total) return;
      results[i] = await fn(items[i], i);
      completed++;
      onDone?.(completed, total);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(workers, total) }, () => worker()),
  );
  return results;
}

export async function writeJsonl(path: string, rows: object[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export async function writeJson(path: string, obj: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(obj, null, 2));
}
