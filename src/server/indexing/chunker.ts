/**
 * Semantic chunking (the LangChain `SemanticChunker` algorithm, in TS):
 *
 *   1. Split the range into sentences.
 *   2. Embed each sentence together with its neighbors (a sliding window of
 *      `bufferSize` on each side) so the signal is a local topic, not one
 *      sentence's phrasing.
 *   3. Cosine distance between consecutive windows; a boundary goes wherever
 *      the distance spikes past the chosen percentile.
 *   4. Enforce size: split groups over `maxTokens` at their largest internal
 *      distances, and merge groups under `minTokens` into a neighbor.
 *
 * Pure apart from the injected `embed` function, so it unit-tests with a fake
 * embedder. Chunk offsets refer to the original text.
 */

import { approxTokens, splitSentences, type Sentence } from "./text";

export interface ChunkerOptions {
  /** Sentences of context on each side of a sentence when embedding windows. */
  bufferSize?: number;
  /** Percentile of consecutive distances above which a boundary is cut. */
  breakpointPercentile?: number;
  /** Groups over this are split at their largest internal distances. */
  maxTokens?: number;
  /** Groups under this are merged into a neighbor. */
  minTokens?: number;
}

export interface Chunk {
  text: string;
  charStart: number;
  charEnd: number;
  tokenCount: number;
}

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const DEFAULTS: Required<ChunkerOptions> = {
  bufferSize: 1,
  breakpointPercentile: 90,
  maxTokens: 512,
  minTokens: 64,
};

/**
 * A chunking job split into "what to embed" and "finish once embedded", so a
 * caller with many ranges (one per section) can embed every range's windows
 * in one batched call instead of one round trip per section.
 */
export interface ChunkPlan {
  /** Sentence windows to embed, in order. Empty when no embedding is needed. */
  windows: string[];
  /** Produce the chunks given one vector per window. */
  finalize: (vectors: number[][]) => Chunk[];
}

export function planChunks(
  text: string,
  charStart: number,
  charEnd: number,
  options: ChunkerOptions = {},
): ChunkPlan {
  const opts = { ...DEFAULTS, ...options };
  const sentences = splitSentences(text, charStart, charEnd);
  if (sentences.length === 0) return { windows: [], finalize: () => [] };
  const sizes = sentences.map((s) => approxTokens(s.text));

  // Too few sentences to measure a topic shift: one chunk, size-capped.
  if (sentences.length < 4) {
    return { windows: [], finalize: () => sizeCapped(sentences, sizes, [], opts) };
  }

  const windows = sentences.map((_, i) => {
    const lo = Math.max(0, i - opts.bufferSize);
    const hi = Math.min(sentences.length - 1, i + opts.bufferSize);
    return sentences
      .slice(lo, hi + 1)
      .map((s) => s.text)
      .join(" ");
  });

  const finalize = (vectors: number[][]): Chunk[] => {
    if (vectors.length !== windows.length) {
      throw new Error(
        `Embedder returned ${vectors.length} vectors for ${windows.length} inputs`,
      );
    }
    // distances[i] is between sentence i and i+1.
    const distances: number[] = [];
    for (let i = 0; i + 1 < vectors.length; i++) {
      distances.push(1 - cosine(vectors[i], vectors[i + 1]));
    }
    const threshold = percentile(distances, opts.breakpointPercentile);
    const breakpoints = new Set<number>();
    distances.forEach((d, i) => {
      if (d > threshold) breakpoints.add(i);
    });
    return sizeCapped(sentences, sizes, distances, opts, breakpoints);
  };

  return { windows, finalize };
}

/** Single-range convenience over {@link planChunks}. */
export async function semanticChunk(
  text: string,
  charStart: number,
  charEnd: number,
  embed: EmbedFn,
  options: ChunkerOptions = {},
): Promise<Chunk[]> {
  const plan = planChunks(text, charStart, charEnd, options);
  const vectors = plan.windows.length > 0 ? await embed(plan.windows) : [];
  return plan.finalize(vectors);
}

/* ------------------------------------------------------------------ */
/*  Size enforcement                                                   */
/* ------------------------------------------------------------------ */

function sizeCapped(
  sentences: Sentence[],
  sizes: number[],
  distances: number[],
  opts: Required<ChunkerOptions>,
  breakpoints: Set<number> = new Set(),
): Chunk[] {
  // Groups as [startIdx, endIdx] inclusive ranges over sentences.
  let groups: Array<[number, number]> = [];
  let start = 0;
  for (let i = 0; i < sentences.length; i++) {
    if (breakpoints.has(i) || i === sentences.length - 1) {
      groups.push([start, i]);
      start = i + 1;
    }
  }

  // Split oversized groups at their largest internal distance (or the
  // middle when there's no distance signal), recursively.
  const split = (g: [number, number]): Array<[number, number]> => {
    const tokens = sum(sizes, g[0], g[1]);
    if (tokens <= opts.maxTokens || g[1] - g[0] < 1) return [g];
    let cut = g[0];
    let best = -Infinity;
    for (let i = g[0]; i < g[1]; i++) {
      // Prefer cuts that leave both halves within bounds; weight by distance.
      const d = distances[i] ?? 0;
      const leftTokens = sum(sizes, g[0], i);
      const balance = 1 - Math.abs(leftTokens / tokens - 0.5);
      const score = d + 0.1 * balance;
      if (score > best) {
        best = score;
        cut = i;
      }
    }
    return [...split([g[0], cut]), ...split([cut + 1, g[1]])];
  };
  groups = groups.flatMap(split);

  // Merge undersized groups into the smaller neighbor, as long as the
  // result stays under max.
  let changed = true;
  while (changed && groups.length > 1) {
    changed = false;
    for (let i = 0; i < groups.length; i++) {
      const tokens = sum(sizes, groups[i][0], groups[i][1]);
      if (tokens >= opts.minTokens) continue;
      const prev = i > 0 ? sum(sizes, groups[i - 1][0], groups[i - 1][1]) : Infinity;
      const next =
        i + 1 < groups.length ? sum(sizes, groups[i + 1][0], groups[i + 1][1]) : Infinity;
      if (prev === Infinity && next === Infinity) break;
      const target = prev <= next ? i - 1 : i + 1;
      const merged = sum(sizes, groups[Math.min(i, target)][0], groups[Math.max(i, target)][1]);
      if (merged > opts.maxTokens) continue;
      const lo = Math.min(i, target);
      groups.splice(lo, 2, [groups[lo][0], groups[lo + 1][1]]);
      changed = true;
      break;
    }
  }

  return groups.map(([a, b]) => ({
    text: sentences
      .slice(a, b + 1)
      .map((s) => s.text)
      .join(" "),
    charStart: sentences[a].start,
    charEnd: sentences[b].end,
    tokenCount: sum(sizes, a, b),
  }));
}

/* ------------------------------------------------------------------ */
/*  Math                                                               */
/* ------------------------------------------------------------------ */

function sum(arr: number[], a: number, b: number): number {
  let s = 0;
  for (let i = a; i <= b; i++) s += arr[i];
  return s;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((x, y) => x - y);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}
