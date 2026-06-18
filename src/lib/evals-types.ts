/**
 * DTOs shared between the eval API routes (src/server/evals.ts) and the
 * Evals dashboard UI (src/components/evals/*). Kept free of server-only
 * imports so the client can import the types.
 *
 * Everything here is derived from the persisted eval tables (see
 * prisma/schema.prisma) — there are no invented fields. Notably absent, because
 * they aren't stored: benchmark reference scores (human / best-LLM), and
 * per-item latency/token counts.
 */

export type EvalOutcome = "CORRECT" | "INCORRECT" | "UNPARSED" | "ERROR";
export type EvalRunStatus = "RUNNING" | "COMPLETED" | "FAILED";

export interface BenchmarkSummary {
  id: string;
  name: string;
  runCount: number;
}

/** One run as shown in the sidebar list and the accuracy-over-runs rail. */
export interface RunSummary {
  id: string;
  /** Model under test, read from the recipe's metadata (falls back to the
   *  recipe name when the recipe doesn't record a model). */
  model: string;
  recipe: string;
  status: EvalRunStatus;
  /** ISO timestamp the run was created. */
  createdAt: string;
  completedAt: string | null;
  /** Correct / total over the items written so far (works for partial runs).
   *  Null only when the run has no items yet. */
  accuracy: number | null;
  total: number;
}

export interface EvalOverview {
  benchmarks: BenchmarkSummary[];
  /** The selected benchmark, or null when there are no benchmarks at all. */
  benchmark: {
    id: string;
    name: string;
    description: string;
    /** Largest item count across the benchmark's runs — the best available
     *  proxy for "how many questions" (the benchmark row stores no size). */
    questionCount: number;
  } | null;
  runs: RunSummary[];
}

/** One per-question row (lightweight: the model response is fetched on demand
 *  via getItemResponse so the run payload stays small). */
export interface RunItem {
  id: string;
  itemKey: string;
  /** From targetMetadata.paper_id, when present. */
  paperId: string | null;
  /** From targetMetadata.question_type, when present (e.g. "SA-MCQ"). */
  type: string | null;
  /** Raw benchmark question text, including embedded answer options when stored. */
  question: string | null;
  gold: string;
  pred: string;
  outcome: EvalOutcome;
}

export interface TypeBreakdown {
  type: string;
  n: number;
  accuracy: number;
}

export interface RunSummaryStats {
  accuracy: number;
  correct: number;
  total: number;
  byType: TypeBreakdown[];
  outcomeCounts: Record<EvalOutcome, number>;
}

export interface RunDetail {
  run: {
    id: string;
    model: string;
    recipe: string;
    status: EvalRunStatus;
    createdAt: string;
    completedAt: string | null;
    total: number;
  };
  summary: RunSummaryStats;
  items: RunItem[];
}

/** Full model response for one item — loaded only when the inspector opens. */
export interface ItemResponse {
  itemKey: string;
  response: string | null;
  note: string | null;
}
