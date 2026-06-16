/**
 * Persist an eval run to the database, modeling it as
 *   EvalBenchmark (the task) → EvalBenchmarkRun (one execution of a Recipe)
 *     → EvalBenchmarkRunItem (per-question) + EvalBenchmarkRunResult (per-metric)
 * (see prisma/schema.prisma). Generic across benchmarks — a runner supplies the
 * benchmark/recipe identity and streams per-item records as questions finish.
 *
 * Items are written INCREMENTALLY (one upsert as each question completes), so a
 * run that crashes mid-way keeps its partial data and its row stays `RUNNING`
 * rather than silently looking complete. `complete()` writes the aggregate
 * metrics and flips the run to `COMPLETED`; `fail()` flips it to `FAILED`.
 *
 * Writes are best-effort: a DB hiccup logs a warning but never aborts the eval
 * itself (the run still writes its JSON output). Upserts are keyed on the
 * schema's unique constraints, so re-running is idempotent per (run, itemKey)
 * and (run, metric).
 */

import type { PrismaClient, Prisma } from "@prisma/client";

export type EvalOutcome = "CORRECT" | "INCORRECT" | "UNPARSED" | "ERROR";

export interface PersistItem {
  /** Stable per-question id (e.g. paper_id + a hash of the question), so the
   *  same question can be compared across runs and recipes. */
  itemKey: string;
  /** The scored gold value (e.g. "ABD"). */
  target: string;
  targetMetadata?: unknown;
  /** The scored prediction (e.g. "AB"). */
  prediction: string;
  predictionMetadata?: unknown;
  predictionOutcome: EvalOutcome;
}

export interface PersistMetric {
  /** Metric name, e.g. "accuracy" or "accuracy:SA-MCQ". */
  metric: string;
  score: number;
  breakdown?: unknown;
}

export interface StartRunParams {
  benchmark: { name: string; description: string };
  recipe: { name: string; description: string; metadata: unknown };
}

/** Map the three independent flags a scorer produces onto the stored outcome.
 *  Order matters: a failed call is ERROR even if it also looks unparsed. */
export function outcomeFor(
  apiOk: boolean,
  unparsed: boolean,
  correct: boolean,
): EvalOutcome {
  if (!apiOk) return "ERROR";
  if (unparsed) return "UNPARSED";
  return correct ? "CORRECT" : "INCORRECT";
}

/** Cast through Prisma's JSON input type; `undefined` stays unset (column keeps
 *  its default / null). Callers pass plain objects, never raw `null`. */
function json(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

export class EvalRunRecorder {
  private itemFailures = 0;

  private constructor(
    private readonly prisma: PrismaClient,
    readonly runId: string,
  ) {}

  /**
   * Upsert the benchmark + recipe (identified by their unique `name`) and open
   * a fresh run in `RUNNING` state. Throws if the run can't be created — the
   * caller decides whether to proceed without persistence.
   */
  static async start(
    prisma: PrismaClient,
    p: StartRunParams,
  ): Promise<EvalRunRecorder> {
    const benchmark = await prisma.evalBenchmark.upsert({
      where: { name: p.benchmark.name },
      update: { description: p.benchmark.description },
      create: { name: p.benchmark.name, description: p.benchmark.description },
    });
    // Upsert updates the recipe's metadata in place. If you need past runs to
    // pin the exact prompts they used even after an edit, version the recipe
    // name (or store a content hash) rather than mutating it here.
    const recipe = await prisma.recipe.upsert({
      where: { name: p.recipe.name },
      update: {
        description: p.recipe.description,
        metadata: json(p.recipe.metadata) ?? {},
      },
      create: {
        name: p.recipe.name,
        description: p.recipe.description,
        metadata: json(p.recipe.metadata) ?? {},
      },
    });
    const run = await prisma.evalBenchmarkRun.create({
      data: {
        evalBenchmarkId: benchmark.id,
        recipeId: recipe.id,
        status: "RUNNING",
      },
    });
    return new EvalRunRecorder(prisma, run.id);
  }

  /** Upsert one per-question record. Best-effort: a failure is counted and
   *  logged once at the end, never thrown. */
  async recordItem(item: PersistItem): Promise<void> {
    const data = {
      itemKey: item.itemKey,
      target: item.target,
      targetMetadata: json(item.targetMetadata),
      prediction: item.prediction,
      predictionMetadata: json(item.predictionMetadata),
      predictionOutcome: item.predictionOutcome,
    };
    try {
      await this.prisma.evalBenchmarkRunItem.upsert({
        where: {
          evalBenchmarkRunId_itemKey: {
            evalBenchmarkRunId: this.runId,
            itemKey: item.itemKey,
          },
        },
        update: data,
        create: { evalBenchmarkRunId: this.runId, ...data },
      });
    } catch (err) {
      this.itemFailures++;
      if (this.itemFailures === 1) {
        console.error(
          `\n  ! failed to persist an eval item (${
            err instanceof Error ? err.message : err
          }); continuing, will report the total.`,
        );
      }
    }
  }

  /** Write the aggregate metrics and mark the run COMPLETED. */
  async complete(metrics: PersistMetric[]): Promise<void> {
    try {
      for (const m of metrics) {
        await this.prisma.evalBenchmarkRunResult.upsert({
          where: {
            evalBenchmarkRunId_metric: {
              evalBenchmarkRunId: this.runId,
              metric: m.metric,
            },
          },
          update: { score: m.score, breakdown: json(m.breakdown) },
          create: {
            evalBenchmarkRunId: this.runId,
            metric: m.metric,
            score: m.score,
            breakdown: json(m.breakdown),
          },
        });
      }
      await this.prisma.evalBenchmarkRun.update({
        where: { id: this.runId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    } catch (err) {
      console.error(
        `\n  ! failed to finalize the eval run (${
          err instanceof Error ? err.message : err
        }); items already written are kept, run left RUNNING.`,
      );
    }
    if (this.itemFailures > 0) {
      console.error(`  ! ${this.itemFailures} item(s) were not persisted.`);
    }
  }

  /** Mark the run FAILED (e.g. the harness threw before completing). */
  async fail(): Promise<void> {
    try {
      await this.prisma.evalBenchmarkRun.update({
        where: { id: this.runId },
        data: { status: "FAILED", completedAt: new Date() },
      });
    } catch {
      /* best-effort */
    }
  }
}
