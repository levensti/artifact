/**
 * Presentation helpers for the Evals dashboard: outcome/type/status color maps
 * and date formatting. Colors are the app's theme tokens (the same "Quiet
 * Precision" palette the rest of Artifact uses), so the dashboard restyles with
 * the app rather than hard-coding hex.
 */

import type { EvalOutcome, EvalRunStatus } from "@/lib/evals-types";

export interface OutcomeMeta {
  label: string;
  bg: string;
  fg: string;
  dot: string;
}

export const OUTCOME_META: Record<EvalOutcome, OutcomeMeta> = {
  CORRECT: {
    label: "Correct",
    bg: "color-mix(in srgb, var(--success) 13%, transparent)",
    fg: "color-mix(in srgb, var(--success) 88%, var(--foreground))",
    dot: "var(--success)",
  },
  INCORRECT: {
    label: "Incorrect",
    bg: "var(--muted)",
    fg: "var(--muted-foreground)",
    dot: "color-mix(in srgb, var(--muted-foreground) 45%, transparent)",
  },
  UNPARSED: {
    label: "Unparsed",
    bg: "color-mix(in srgb, var(--warning) 14%, transparent)",
    fg: "color-mix(in srgb, var(--warning) 88%, var(--foreground))",
    dot: "var(--warning)",
  },
  ERROR: {
    label: "Error",
    bg: "color-mix(in srgb, var(--destructive) 11%, transparent)",
    fg: "color-mix(in srgb, var(--destructive) 85%, var(--foreground))",
    dot: "var(--destructive)",
  },
};

export const OUTCOME_ORDER: EvalOutcome[] = [
  "CORRECT",
  "INCORRECT",
  "UNPARSED",
  "ERROR",
];

export function typeBadge(type: string): { bg: string; fg: string } {
  // Highlight multi-answer types; everything else reads as neutral.
  return /MA/i.test(type)
    ? {
        bg: "color-mix(in srgb, var(--primary) 11%, transparent)",
        fg: "color-mix(in srgb, var(--primary) 88%, transparent)",
      }
    : { bg: "var(--muted)", fg: "var(--muted-foreground)" };
}

export interface StatusMeta {
  label: string;
  bg: string;
  fg: string;
  dot: string;
  animate: boolean;
}

export const STATUS_META: Record<EvalRunStatus, StatusMeta> = {
  COMPLETED: {
    label: "Completed",
    bg: "color-mix(in srgb, var(--success) 13%, transparent)",
    fg: "color-mix(in srgb, var(--success) 85%, var(--foreground))",
    dot: "var(--success)",
    animate: false,
  },
  RUNNING: {
    label: "Running",
    bg: "color-mix(in srgb, var(--primary) 11%, transparent)",
    fg: "color-mix(in srgb, var(--primary) 85%, transparent)",
    dot: "var(--primary)",
    animate: true,
  },
  FAILED: {
    label: "Failed",
    bg: "color-mix(in srgb, var(--destructive) 11%, transparent)",
    fg: "var(--destructive)",
    dot: "var(--destructive)",
    animate: false,
  },
};

export function pct(x: number): string {
  return (x * 100).toFixed(1) + "%";
}

/** Local YYYY-M-D key for grouping/relative-day labels. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today" / "Yesterday" / "Jan 14, 2026" for a run's createdAt, in local tz. */
export function groupLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return "Today";
  if (dayKey(d) === dayKey(yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dateTimeLabel(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) +
    " · " +
    timeLabel(iso)
  );
}

/** Short, stable run id fragment for display. */
export function shortRunId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Upper bound for the accuracy axis: round the best run accuracy up to the next
 * 10% with a little headroom, clamped to [10, 100]. No reference scores are
 * stored, so the axis is driven purely by the runs.
 */
export function accuracyDomainMax(accuracies: number[]): number {
  const top = Math.max(0, ...accuracies) * 100;
  return Math.min(100, Math.max(10, Math.ceil((top + 8) / 10) * 10));
}
