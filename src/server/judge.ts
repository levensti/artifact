/**
 * Jev judge client: scores research candidates with TypeSafe's Jev models
 * (Score primitive, `POST /v1/systemone`). The rubric is in
 * `src/lib/judge-rubric.ts`.
 *
 * Used to screen the wide pool of search results in the discover funnel
 * (`src/server/discover-funnel.ts`), and to score any final pick that wasn't
 * screened. Judging is an enhancement: with no key, or when TypeSafe fails,
 * callers keep the agent's own order.
 *
 * Server code only (`JEV_API_KEY` never leaves the server). Without a key, nothing is graded: the funnel passes sources through
 * unscored and the agent's order stands.
 *
 * Throughput: the account allows 80 requests and 100k input tokens per
 * second, shared by every user. Each request takes a permit from a
 * per-second window kept in Redis (so all serverless instances share it)
 * and from a local window (a backstop when Redis is unset). Both fail open:
 * a limiter problem never blocks research. 429 / 5xx are retried with
 * backoff.
 */

import { Redis } from "@upstash/redis";
import {
  buildJudgeRequest,
  compositeScore,
  type DimensionResult,
  type JudgeCandidate,
  type JudgeContext,
  type JudgeDetail,
} from "@/lib/judge-rubric";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;

/** Headroom under the account's 80 req/s and 100k input tokens/s. */
const REQUESTS_PER_SECOND = 70;
const TOKENS_PER_SECOND = 90_000;
/** Requests in flight per process. */
const CONCURRENCY = 32;

function apiKey(): string | null {
  const raw = process.env.JEV_API_KEY;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || null;
}

function model(): string {
  return process.env.JEV_MODEL?.trim() || "jev-latest";
}

export function judgeAvailable(): boolean {
  return apiKey() !== null;
}

export interface JudgeResult {
  /** Weighted 0 to 1. */
  score: number;
  detail: JudgeDetail;
}

interface SystemOneResponse {
  model?: string;
  answers?: Record<
    string,
    { type?: string; score?: number; confidence?: number } | undefined
  >;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/*  Rate limiting (per-second windows; fail-open)                      */
/* ------------------------------------------------------------------ */

let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

/** Rough input-token estimate for a request body (~4 chars per token). */
function estimateTokens(body: string): number {
  return Math.ceil(body.length / 4);
}

const local = { second: 0, requests: 0, tokens: 0 };

/** Take a slot in this process's current second, or say how long to wait. */
function takeLocal(tokens: number): number {
  const now = Date.now();
  const second = Math.floor(now / 1000);
  if (second !== local.second) {
    local.second = second;
    local.requests = 0;
    local.tokens = 0;
  }
  if (
    local.requests + 1 > REQUESTS_PER_SECOND ||
    local.tokens + tokens > TOKENS_PER_SECOND
  ) {
    return 1000 - (now % 1000) + 5;
  }
  local.requests += 1;
  local.tokens += tokens;
  return 0;
}

/** Take a slot in the shared (cross-instance) current second, or say how
 *  long to wait. 0 when Redis is unset or unreachable. */
async function takeShared(tokens: number): Promise<number> {
  const client = getRedis();
  if (!client) return 0;
  try {
    const now = Date.now();
    const second = Math.floor(now / 1000);
    const rKey = `jev:rps:${second}`;
    const tKey = `jev:tps:${second}`;
    const [requests, used] = await Promise.all([
      client.incr(rKey),
      client.incrby(tKey, tokens),
    ]);
    if (requests === 1) void client.expire(rKey, 5);
    if (used === tokens) void client.expire(tKey, 5);
    if (requests > REQUESTS_PER_SECOND || used > TOKENS_PER_SECOND) {
      return 1000 - (now % 1000) + 5;
    }
    return 0;
  } catch {
    return 0; // limiter outage must never block research
  }
}

/** Wait until both windows have room for a request of `tokens`. Bounded so
 *  a stuck window can't hang a run. */
async function acquirePermit(tokens: number): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const localWait = takeLocal(tokens);
    if (localWait > 0) {
      await sleep(localWait);
      continue;
    }
    const sharedWait = await takeShared(tokens);
    if (sharedWait === 0) return;
    await sleep(sharedWait);
  }
}

/* ------------------------------------------------------------------ */
/*  Requests                                                           */
/* ------------------------------------------------------------------ */

class TypeSafeError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** One TypeSafe call, retried with backoff on 429, 5xx (incl. 529 overload),
 *  timeouts, and network errors. */
async function callSystemOne(
  key: string,
  body: unknown,
): Promise<SystemOneResponse> {
  const payload = JSON.stringify(body);
  const tokens = estimateTokens(payload);
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(8_000, 500 * 2 ** (attempt - 1)) + Math.random() * 250);
    }
    await acquirePermit(tokens);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()) as SystemOneResponse;
      const text = await res.text().catch(() => "");
      throw new TypeSafeError(
        `TypeSafe ${res.status}: ${text.slice(0, 300)}`,
        res.status === 429 || res.status >= 500,
      );
    } catch (err) {
      lastError = err;
      // fetch throws TypeError on network failure, TimeoutError on timeout.
      const retryable =
        err instanceof TypeSafeError
          ? err.retryable
          : (err as Error)?.name === "TimeoutError" ||
            (err as Error)?.name === "TypeError";
      if (!retryable) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("TypeSafe request failed");
}

/** Score one candidate. Throws when TypeSafe fails or returns nothing usable. */
export async function judgePick(
  context: JudgeContext,
  candidate: JudgeCandidate,
): Promise<JudgeResult> {
  const key = apiKey();
  if (!key) throw new Error("JEV_API_KEY is not set");
  const response = await callSystemOne(
    key,
    buildJudgeRequest(context, candidate, model()),
  );

  const dimensions: Record<string, DimensionResult> = {};
  for (const [id, answer] of Object.entries(response.answers ?? {})) {
    if (!answer || typeof answer.score !== "number") continue;
    dimensions[id] = {
      score: answer.score,
      confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
    };
  }
  const score = compositeScore(dimensions);
  if (score === null) throw new Error("TypeSafe returned no scores");
  return {
    score,
    detail: { model: response.model ?? model(), dimensions },
  };
}

/**
 * Score many candidates, up to `CONCURRENCY` at a time within the rate
 * limits. A candidate whose call fails gets null rather than failing the
 * whole batch.
 */
export async function judgePicks(
  context: JudgeContext,
  candidates: JudgeCandidate[],
): Promise<(JudgeResult | null)[]> {
  const results: (JudgeResult | null)[] = new Array(candidates.length).fill(null);
  // No key: nothing to grade with. Callers treat all-null as "unscored".
  if (!judgeAvailable()) return results;
  let next = 0;
  let failures = 0;
  let firstError: string | null = null;
  const worker = async () => {
    while (next < candidates.length) {
      const i = next++;
      try {
        results[i] = await judgePick(context, candidates[i]);
      } catch (err) {
        failures++;
        firstError ??= err instanceof Error ? err.message : String(err);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker),
  );
  if (failures > 0) {
    console.error("Judge failed for some candidates", {
      failures,
      total: candidates.length,
      firstError,
    });
  }
  return results;
}
