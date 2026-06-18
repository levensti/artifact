import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "./auth";
import { prisma } from "./db";
import { HttpError, errorResponse } from "./api";
import { isAdminEmail } from "@/lib/admin";
import type {
  BenchmarkSummary,
  EvalOutcome,
  EvalOverview,
  EvalRunStatus,
  ItemResponse,
  RunDetail,
  RunItem,
  RunSummary,
  RunSummaryStats,
  TypeBreakdown,
} from "@/lib/evals-types";

/**
 * Server-side data layer for the Evals dashboard. The whole feature is gated to
 * a single admin: eval runs are dev/infra output (not user-scoped), so rather
 * than per-user ownership these reads require the admin email. Computed from the
 * persisted eval tables only — accuracy and breakdowns are derived from the
 * items so they're correct for partial (RUNNING / FAILED) runs too, where no
 * aggregate result rows exist yet.
 */

const OUTCOMES: EvalOutcome[] = ["CORRECT", "INCORRECT", "UNPARSED", "ERROR"];
const ELAIP_BENCH_DATASET_URL =
  "https://huggingface.co/datasets/KangKang625/ELAIPBench/resolve/main/elabench.jsonl";

interface ElaipBenchRow {
  paper_id?: string;
  question: string;
  paper_content?: string;
}

let elaipRowsPromise: Promise<Map<string, ElaipBenchRow>> | null = null;

/** Throw 403 unless the caller is the admin. */
async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    throw new HttpError(403, "Forbidden");
  }
}

/**
 * Wrap an eval route handler with the admin gate + error normalization, mirror
 * of `authedRoute` but keyed on the admin email instead of any signed-in user.
 */
export function adminRoute<Args extends unknown[], R>(
  handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R | NextResponse> {
  return async (...args: Args) => {
    try {
      await requireAdmin();
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Read `model` out of a recipe's JSON metadata, if present. */
function modelFromMetadata(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object" && "model" in metadata) {
    const m = (metadata as { model?: unknown }).model;
    if (typeof m === "string" && m.trim()) return m;
  }
  return null;
}

/** Pull a string field out of an item's targetMetadata JSON. */
function metaString(metadata: unknown, key: string): string | null {
  if (metadata && typeof metadata === "object" && key in metadata) {
    const v = (metadata as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

function emptyCounts(): Record<EvalOutcome, number> {
  return { CORRECT: 0, INCORRECT: 0, UNPARSED: 0, ERROR: 0 };
}

function elaipItemKey(row: ElaipBenchRow): string {
  const hash = createHash("sha1").update(row.question).digest("hex").slice(0, 12);
  return `${row.paper_id ?? "unknown"}:${hash}`;
}

async function loadElaipRowsByItemKey(): Promise<Map<string, ElaipBenchRow>> {
  elaipRowsPromise ??= fetch(ELAIP_BENCH_DATASET_URL)
    .then(async (resp) => {
      if (!resp.ok) {
        throw new Error(`HF fetch ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      }
      const byKey = new Map<string, ElaipBenchRow>();
      for (const line of (await resp.text()).split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const row = JSON.parse(trimmed) as ElaipBenchRow;
        byKey.set(elaipItemKey(row), row);
      }
      return byKey;
    })
    .catch((err) => {
      elaipRowsPromise = null;
      throw err;
    });
  return elaipRowsPromise;
}

/**
 * The overview payload: every benchmark (with run counts), and for the selected
 * benchmark its runs with a derived accuracy. One groupBy gets all runs'
 * outcome tallies so we don't load item rows here.
 */
export async function getEvalOverview(
  benchmarkId?: string,
): Promise<EvalOverview> {
  const benchmarkRows = await prisma.evalBenchmark.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { runs: true } } },
  });

  const benchmarks: BenchmarkSummary[] = benchmarkRows.map((b) => ({
    id: b.id,
    name: b.name,
    runCount: b._count.runs,
  }));

  // Default to the first benchmark that has runs, else the first one.
  const selected =
    benchmarkRows.find((b) => b.id === benchmarkId) ??
    benchmarkRows.find((b) => b._count.runs > 0) ??
    benchmarkRows[0];

  if (!selected) {
    return { benchmarks, benchmark: null, runs: [] };
  }

  const runRows = await prisma.evalBenchmarkRun.findMany({
    where: { evalBenchmarkId: selected.id },
    orderBy: { createdAt: "desc" },
    include: { recipe: true },
  });
  const runIds = runRows.map((r) => r.id);

  // All runs' outcome counts in one query.
  const grouped = runIds.length
    ? await prisma.evalBenchmarkRunItem.groupBy({
        by: ["evalBenchmarkRunId", "predictionOutcome"],
        where: { evalBenchmarkRunId: { in: runIds } },
        _count: { _all: true },
      })
    : [];

  const countsByRun = new Map<string, Record<EvalOutcome, number>>();
  for (const id of runIds) countsByRun.set(id, emptyCounts());
  for (const g of grouped) {
    const c = countsByRun.get(g.evalBenchmarkRunId);
    if (c) c[g.predictionOutcome as EvalOutcome] = g._count._all;
  }

  const runs: RunSummary[] = runRows.map((r) => {
    const c = countsByRun.get(r.id) ?? emptyCounts();
    const total = OUTCOMES.reduce((s, o) => s + c[o], 0);
    return {
      id: r.id,
      model: modelFromMetadata(r.recipe.metadata) ?? r.recipe.name,
      recipe: r.recipe.name,
      status: r.status as EvalRunStatus,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      accuracy: total ? c.CORRECT / total : null,
      total,
    };
  });

  const questionCount = runs.reduce((max, r) => Math.max(max, r.total), 0);

  return {
    benchmarks,
    benchmark: {
      id: selected.id,
      name: selected.name,
      description: selected.description,
      questionCount,
    },
    runs,
  };
}

/**
 * One run's full per-question table plus a derived summary (overall accuracy,
 * per-question-type breakdown, outcome mix). The heavy model responses are NOT
 * included — the inspector fetches a single item's response via
 * getItemResponse.
 */
export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  const run = await prisma.evalBenchmarkRun.findUnique({
    where: { id: runId },
    include: { recipe: true },
  });
  if (!run) return null;

  const rows = await prisma.evalBenchmarkRunItem.findMany({
    where: { evalBenchmarkRunId: runId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      itemKey: true,
      target: true,
      prediction: true,
      predictionOutcome: true,
      targetMetadata: true,
    },
  });

  const items: RunItem[] = rows.map((it) => ({
    id: it.id,
    itemKey: it.itemKey,
    paperId: metaString(it.targetMetadata, "paper_id"),
    type: metaString(it.targetMetadata, "question_type"),
    question: metaString(it.targetMetadata, "question"),
    gold: it.target,
    pred: it.prediction,
    outcome: it.predictionOutcome as EvalOutcome,
  }));

  const outcomeCounts = emptyCounts();
  const typeAgg = new Map<string, { n: number; correct: number }>();
  let correct = 0;
  for (const it of items) {
    outcomeCounts[it.outcome]++;
    const isCorrect = it.outcome === "CORRECT";
    if (isCorrect) correct++;
    if (it.type) {
      const t = typeAgg.get(it.type) ?? { n: 0, correct: 0 };
      t.n++;
      if (isCorrect) t.correct++;
      typeAgg.set(it.type, t);
    }
  }
  const total = items.length;
  const byType: TypeBreakdown[] = [...typeAgg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, t]) => ({ type, n: t.n, accuracy: t.n ? t.correct / t.n : 0 }));

  const summary: RunSummaryStats = {
    accuracy: total ? correct / total : 0,
    correct,
    total,
    byType,
    outcomeCounts,
  };

  return {
    run: {
      id: run.id,
      model: modelFromMetadata(run.recipe.metadata) ?? run.recipe.name,
      recipe: run.recipe.name,
      status: run.status as EvalRunStatus,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      total,
    },
    summary,
    items,
  };
}

/** Heavy item payload for the inspector: model response and paper text. */
export async function getItemResponse(
  itemId: string,
): Promise<ItemResponse | null> {
  const row = await prisma.evalBenchmarkRunItem.findUnique({
    where: { id: itemId },
    select: { itemKey: true, predictionMetadata: true },
  });
  if (!row) return null;
  const md = row.predictionMetadata;
  let paperContent: string | null = null;
  try {
    paperContent = (await loadElaipRowsByItemKey()).get(row.itemKey)?.paper_content ?? null;
  } catch {
    paperContent = null;
  }
  return {
    itemKey: row.itemKey,
    response: metaString(md, "response"),
    note: metaString(md, "note"),
    paperContent,
  };
}
