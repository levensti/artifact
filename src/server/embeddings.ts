/**
 * Fireworks embeddings client.
 *
 * One model, one width: `qwen3-embedding-8b`, truncated to 2048 dims. Qwen3
 * embeddings are Matryoshka-trained, so the leading dims are a valid
 * embedding on their own; we truncate and re-normalize locally rather than
 * relying on a `dimensions` request parameter. 2048 keeps the vectors inside
 * pgvector's indexable width for `halfvec` (4000) with most of the 4096-dim
 * quality.
 *
 * Throughput discipline (one account serves every user):
 *   - inputs are batched (`BATCH_SIZE` per request),
 *   - at most `CONCURRENCY` requests in flight per process,
 *   - every request takes a permit from the shared Redis limiter so the
 *     platform's requests-per-minute cap is respected across all serverless
 *     instances (fail-open when Redis is unconfigured, like the chat limiter),
 *   - 429 / 5xx are retried with exponential backoff.
 *
 * Free of `server-only` / DB imports so the chunker tests can import it.
 */

import { Redis } from "@upstash/redis";
import { FIREWORKS_BASE_URL } from "@/lib/fireworks";
import { parseApiErrorMessage } from "@/lib/api-utils";

export const EMBEDDING_MODEL = "accounts/fireworks/models/qwen3-embedding-8b";
export const EMBEDDING_DIMS = 2048;

const EMBEDDINGS_URL = `${FIREWORKS_BASE_URL}/embeddings`;
const BATCH_SIZE = 64;
const CONCURRENCY = 4;
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 60_000;

/** Platform-wide embedding requests per minute (override via env). */
const RPM = (() => {
  const n = Number.parseInt(process.env.EMBEDDING_RPM ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 300;
})();

export interface EmbedUsage {
  /** Prompt tokens the provider billed across all requests. */
  tokens: number;
  requests: number;
}

/* ------------------------------------------------------------------ */
/*  Global limiter (fixed 60s window in Redis; fail-open)              */
/* ------------------------------------------------------------------ */

let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

/** Block until a request permit is available (bounded wait, fail-open). */
async function acquirePermit(): Promise<void> {
  const client = getRedis();
  if (!client) return;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const window = Math.floor(Date.now() / 60_000);
      const key = `emb:rpm:${window}`;
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, 120);
      if (count <= RPM) return;
      // Over the cap for this minute: wait for the window to roll over.
      const msLeft = 60_000 - (Date.now() % 60_000);
      await sleep(Math.min(msLeft + 50, 5_000));
    } catch {
      return; // limiter outage must never block indexing
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/*  API                                                                */
/* ------------------------------------------------------------------ */

/**
 * Embed `texts` in order. Returns one unit-normalized vector of
 * `EMBEDDING_DIMS` per input. `onUsage` fires once with the summed usage.
 */
export async function embedTexts(
  apiKey: string,
  texts: string[],
  onUsage?: (usage: EmbedUsage) => void,
  /** Fires after each batch completes with (inputs done, inputs total). */
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const batches: Array<{ start: number; inputs: string[] }> = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push({ start: i, inputs: texts.slice(i, i + BATCH_SIZE) });
  }
  const out: number[][] = new Array(texts.length);
  const usage: EmbedUsage = { tokens: 0, requests: 0 };

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const vectors = await embedBatch(apiKey, batch.inputs, usage);
      vectors.forEach((v, j) => {
        out[batch.start + j] = v;
      });
      done += batch.inputs.length;
      onProgress?.(done, texts.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker),
  );
  onUsage?.(usage);
  return out;
}

async function embedBatch(
  apiKey: string,
  inputs: string[],
  usage: EmbedUsage,
): Promise<number[][]> {
  let delay = 1_000;
  for (let attempt = 0; ; attempt++) {
    await acquirePermit();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt >= MAX_RETRIES) throw err;
      await sleep(delay);
      delay *= 2;
      continue;
    }
    clearTimeout(timer);
    usage.requests += 1;

    if (response.status === 429 || response.status >= 500) {
      const text = await response.text().catch(() => "");
      if (attempt >= MAX_RETRIES) {
        throw new Error(
          parseApiErrorMessage(text, `Fireworks embeddings error: ${response.status}`),
        );
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay);
      delay = Math.min(delay * 2, 30_000);
      continue;
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        parseApiErrorMessage(text, `Fireworks embeddings error: ${response.status}`),
      );
    }

    const data = (await response.json()) as {
      data?: Array<{ index?: number; embedding?: number[] }>;
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };
    usage.tokens += data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0;
    const rows = data.data ?? [];
    if (rows.length !== inputs.length) {
      throw new Error(
        `Fireworks embeddings returned ${rows.length} vectors for ${inputs.length} inputs`,
      );
    }
    const out: number[][] = new Array(inputs.length);
    rows.forEach((row, i) => {
      const idx = typeof row.index === "number" ? row.index : i;
      out[idx] = truncateNormalize(row.embedding ?? []);
    });
    return out;
  }
}

/** Keep the leading `EMBEDDING_DIMS` dims and rescale to unit length. */
export function truncateNormalize(vector: number[]): number[] {
  const v = vector.slice(0, EMBEDDING_DIMS);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/** pgvector literal: "[0.1,0.2,...]". */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((x) => x.toPrecision(6)).join(",")}]`;
}
