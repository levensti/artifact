import "server-only";

/**
 * Per-user token-bucket rate limiter for platform LLM spend.
 *
 * The app can call OpenRouter with either a shared PLATFORM key or a user's own
 * key. We give every signed-in user a free per-user allowance on the platform
 * key and only fall back to their own key once that allowance is spent — so the
 * platform allowance is always consumed FIRST, and a user's own key is overflow
 * rather than an override (see `resolveMeteredKey`).
 *
 * Two independent buckets per user, BOTH enforced:
 *   - hour: 200,000 tokens, refilling continuously over an hour
 *   - day:  1,000,000 tokens, refilling continuously over a day
 * The hourly bucket caps short bursts; the daily bucket caps sustained use.
 *
 * Algorithm: classic token bucket with LAZY refill — nothing tops buckets up in
 * the background. We store `{tokens, ts}` per bucket and, on each access,
 * compute how much would have refilled in the elapsed time. All of it runs as
 * an atomic Redis Lua script (read-modify-write must not race across the many
 * concurrent serverless instances), reading Redis server `TIME` so there's no
 * clock skew between instances.
 *
 * Admission is deliberately GENEROUS: a request is admitted whenever the user
 * has ANY positive balance — we never refuse based on a guessed worst-case
 * output size. We then `charge` the REAL usage once the stream finishes. A
 * heavy request can push a bucket negative (bounded to -capacity, so a single
 * overage locks the user out for at most one window); refill climbs it back to
 * positive, at which point the user is admitted again.
 *
 * Fail-open: if Upstash isn't configured (local dev) the limiter is disabled,
 * and any Redis error allows the request — a limiter outage must never take
 * down chat.
 */

import { Redis } from "@upstash/redis";
import { resolveOpenRouterKey } from "./provider-env";
import { requireUserId } from "./api";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Bucket capacities (tokens). Overridable via env for testing tiny caps. */
export const DAILY_LIMIT = envInt("RATE_LIMIT_DAILY_TOKENS", 1_000_000);
export const HOURLY_LIMIT = envInt("RATE_LIMIT_HOURLY_TOKENS", 200_000);

const HOUR_SECONDS = 3_600;
const DAY_SECONDS = 86_400;

/** A bucket's continuous refill rate is capacity / window. */
const HOURLY_REFILL_PER_SEC = HOURLY_LIMIT / HOUR_SECONDS;
const DAILY_REFILL_PER_SEC = DAILY_LIMIT / DAY_SECONDS;

/** Idle keys self-evict after ~2× their window (a fresh key starts full). */
const HOUR_TTL = HOUR_SECONDS * 2;
const DAY_TTL = DAY_SECONDS * 2;

function hourKey(userId: string): string {
  return `rl:${userId}:hour`;
}
function dayKey(userId: string): string {
  return `rl:${userId}:day`;
}

/**
 * Weight applied to cached input tokens when counting usage. The provider bills
 * cache reads at roughly a tenth of full input price, so we count them at 10%
 * toward the limit — keeping the budget cost-weighted rather than penalizing
 * the (large, cacheable) static paper prefix re-sent on every turn.
 */
export const CACHE_READ_WEIGHT = 0.1;

/**
 * Tokens charged against a user's budget for one usage report: full-rate input
 * and output, cache reads discounted by {@link CACHE_READ_WEIGHT}. Returns a
 * float; `charge` rounds when it debits.
 */
export function meteredTokens(
  inputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
): number {
  return inputTokens + cacheReadTokens * CACHE_READ_WEIGHT + outputTokens;
}

/** Shared bucket params for the Lua scripts: hourCap, hourRate, dayCap, dayRate. */
function bucketArgs(): [number, number, number, number] {
  return [HOURLY_LIMIT, HOURLY_REFILL_PER_SEC, DAILY_LIMIT, DAILY_REFILL_PER_SEC];
}

/* ------------------------------------------------------------------ */
/*  Client (lazy singleton, null when unconfigured)                    */
/* ------------------------------------------------------------------ */

let cachedClient: Redis | null | undefined;

function getClient(): Redis | null {
  if (cachedClient !== undefined) return cachedClient;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  cachedClient = url && token ? new Redis({ url, token }) : null;
  return cachedClient;
}

/** Whether the limiter is active. False in dev with no Upstash configured. */
export function rateLimitEnabled(): boolean {
  return getClient() !== null;
}

/* ------------------------------------------------------------------ */
/*  Lua scripts (atomic read-modify-write)                             */
/* ------------------------------------------------------------------ */

/**
 * Read-only budget check: refill both buckets from elapsed time and report
 * whether BOTH currently hold a positive balance. Writes nothing (the lazy
 * refill is recomputed from the stored `ts` on the later charge).
 *
 * KEYS[1]=hourKey KEYS[2]=dayKey
 * ARGV: hourCap hourRate dayCap dayRate
 * Returns: 1 when both buckets are positive, else 0.
 */
const CHECK_LUA = `
local now = redis.call('TIME')
local nowf = tonumber(now[1]) + tonumber(now[2]) / 1000000

local function level(key, cap, rate)
  local d = redis.call('HMGET', key, 'tokens', 'ts')
  local t = tonumber(d[1])
  local ts = tonumber(d[2])
  if t == nil or ts == nil then return cap end
  local lvl = t + (nowf - ts) * rate
  if lvl > cap then lvl = cap end
  return lvl
end

local hourLvl = level(KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]))
local dayLvl = level(KEYS[2], tonumber(ARGV[3]), tonumber(ARGV[4]))
if hourLvl > 0 and dayLvl > 0 then return 1 else return 0 end
`;

/**
 * Debit `amount` real tokens from both buckets, after applying the lazy refill
 * for elapsed time. Clamped to [-cap, cap]: a bucket may go negative (the user
 * overran their allowance) but no further than one full capacity, bounding the
 * lockout to at most one refill window.
 *
 * KEYS[1]=hourKey KEYS[2]=dayKey
 * ARGV: hourCap hourRate dayCap dayRate amount hourTtl dayTtl
 */
const CHARGE_LUA = `
local now = redis.call('TIME')
local nowf = tonumber(now[1]) + tonumber(now[2]) / 1000000

local function debit(key, cap, rate, amt, ttl)
  local d = redis.call('HMGET', key, 'tokens', 'ts')
  local t = tonumber(d[1])
  local ts = tonumber(d[2])
  if t == nil or ts == nil then
    t = cap
    ts = nowf
  end
  local lvl = t + (nowf - ts) * rate - amt
  if lvl > cap then lvl = cap end
  if lvl < -cap then lvl = -cap end
  redis.call('HMSET', key, 'tokens', lvl, 'ts', nowf)
  redis.call('EXPIRE', key, ttl)
end

local amt = tonumber(ARGV[5])
debit(KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), amt, tonumber(ARGV[6]))
debit(KEYS[2], tonumber(ARGV[3]), tonumber(ARGV[4]), amt, tonumber(ARGV[7]))
return 1
`;

/* ------------------------------------------------------------------ */
/*  Budget primitives                                                  */
/* ------------------------------------------------------------------ */

/**
 * Whether the user has any platform allowance left in BOTH buckets. Read-only.
 * Fails OPEN (returns true) when the limiter is disabled or Redis errors.
 */
async function hasBudget(userId: string): Promise<boolean> {
  const client = getClient();
  if (!client) return true;
  try {
    const res = await client.eval(
      CHECK_LUA,
      [hourKey(userId), dayKey(userId)],
      bucketArgs(),
    );
    return Number(res) === 1;
  } catch (err) {
    console.error("[rate-limit] budget check failed, allowing request:", err);
    return true;
  }
}

/**
 * Charge real token usage against the user's buckets after a request finishes.
 * Best-effort: errors are logged and swallowed; no-op when the limiter is
 * disabled or nothing was used.
 */
export async function charge(userId: string, actualTokens: number): Promise<void> {
  const client = getClient();
  if (!client) return;
  const amount = Math.round(actualTokens);
  if (amount <= 0) return;
  try {
    await client.eval(
      CHARGE_LUA,
      [hourKey(userId), dayKey(userId)],
      [...bucketArgs(), amount, HOUR_TTL, DAY_TTL],
    );
  } catch (err) {
    console.error("[rate-limit] charge failed (best-effort):", err);
  }
}

/* ------------------------------------------------------------------ */
/*  Budget-aware key resolution                                        */
/* ------------------------------------------------------------------ */

export type KeyOutcome =
  | { ok: true; apiKey: string; meter: boolean; userId: string | null }
  | { ok: false; reason: "rate_limited" | "no_key" };

/**
 * Decide which OpenRouter key a request should use, spending the user's free
 * platform allowance before their own key:
 *
 *   1. No platform key configured, or limiter disabled → original behavior:
 *      the user's own key wins, else the platform key, else `no_key` (401).
 *      Nothing is metered.
 *   2. Platform key + limiter active:
 *      - allowance remaining → use the PLATFORM key and meter the usage.
 *      - allowance spent, user has own key → use the USER key, unmetered.
 *      - allowance spent, no own key → `rate_limited` (surface the BYOK prompt).
 *
 * Resolving the user is required only in case (2); it throws `HttpError(401)`
 * via `requireUserId`, which callers already translate to a JSON 401.
 */
export async function resolveMeteredKey(
  inlineUserKey: string | null | undefined,
): Promise<KeyOutcome> {
  const userKey =
    typeof inlineUserKey === "string" && inlineUserKey.trim()
      ? inlineUserKey.trim()
      : null;
  const platformKey = resolveOpenRouterKey(null); // env key, or null

  // Case 1: no platform metering possible.
  if (!platformKey || !rateLimitEnabled()) {
    const key = userKey ?? platformKey;
    if (!key) return { ok: false, reason: "no_key" };
    return { ok: true, apiKey: key, meter: false, userId: null };
  }

  // Case 2: spend the platform allowance first.
  const userId = await requireUserId();
  if (await hasBudget(userId)) {
    return { ok: true, apiKey: platformKey, meter: true, userId };
  }
  if (userKey) {
    return { ok: true, apiKey: userKey, meter: false, userId };
  }
  return { ok: false, reason: "rate_limited" };
}
