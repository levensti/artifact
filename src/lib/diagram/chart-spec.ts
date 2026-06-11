import { z } from "zod";
import { extractJsonSubstring } from "@/lib/json-parse";

/**
 * The native ```chart fence: a tiny JSON spec the model emits instead of
 * Mermaid's beta chart grammars (xychart/pie/radar), which it constantly
 * broke. The model supplies only DATA; presentation lives entirely in
 * <ChartRenderer>, themed by the app's CSS variables.
 *
 * Parsing is deliberately repair-not-reject: anything that can be made
 * honest deterministically (mismatched lengths, a pie that can't be a pie)
 * is normalized rather than failed, because the alternative the user sees
 * is no visual at all.
 */

export const MAX_POINTS = 12;
export const MAX_SERIES = 4;
export const MAX_PIE_SLICES = 8;

const seriesSchema = z.object({
  name: z.string().trim().max(40).optional(),
  values: z.array(z.number().finite()).min(1).max(MAX_POINTS),
});

export const chartSpecSchema = z.object({
  type: z.enum(["bar", "line", "pie"]),
  title: z.string().trim().min(1).max(80).optional(),
  /** Unit suffix applied when formatting values: "%", "ms", "GB"… */
  unit: z.string().trim().max(12).optional(),
  labels: z
    .array(z.coerce.string().trim().min(1).max(60))
    .min(1)
    .max(MAX_POINTS),
  series: z.array(seriesSchema).min(1).max(MAX_SERIES),
  /** bar, single-series only; omitted = the model's order is preserved. */
  sort: z.enum(["asc", "desc"]).optional(),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;

/** Spec after normalization — what components render. Every series has
 *  exactly labels.length values. */
export interface NormalizedChart {
  type: "bar" | "line" | "pie";
  title?: string;
  unit?: string;
  labels: string[];
  series: Array<{ name?: string; values: number[] }>;
}

export type ChartParseResult =
  | { ok: true; chart: NormalizedChart }
  | { ok: false; reason: "invalid-json" | "invalid-spec" };

function parseJsonLenient(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  for (const candidate of [trimmed, extractJsonSubstring(trimmed)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export function parseChartSpec(raw: string): ChartParseResult {
  const json = parseJsonLenient(raw);
  if (json === undefined) return { ok: false, reason: "invalid-json" };

  const parsed = chartSpecSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "invalid-spec" };
  const spec = parsed.data;

  // Reconcile lengths: the model's most likely slip is labels and values
  // disagreeing — truncate everything to the common minimum.
  const len = Math.min(
    MAX_POINTS,
    spec.labels.length,
    ...spec.series.map((s) => s.values.length),
  );
  let labels = spec.labels.slice(0, len);
  let series = spec.series
    .slice(0, MAX_SERIES)
    .map((s) => ({ name: s.name, values: s.values.slice(0, len) }));
  let type = spec.type;

  if (type === "pie") {
    // A donut can only show non-negative parts of a whole, and only so many
    // slices; otherwise a bar shows the same data honestly.
    series = series.slice(0, 1);
    const values = series[0].values;
    const unsuitable =
      values.some((v) => v < 0) ||
      values.every((v) => v === 0) ||
      values.length > MAX_PIE_SLICES;
    if (unsuitable) type = "bar";
  }

  // A one-point line is just a bar.
  if (type === "line" && len === 1) type = "bar";

  if (spec.sort && type === "bar" && series.length === 1) {
    const order = labels
      .map((label, i) => ({ label, value: series[0].values[i] }))
      .sort((a, b) =>
        spec.sort === "asc" ? a.value - b.value : b.value - a.value,
      );
    labels = order.map((p) => p.label);
    series = [{ name: series[0].name, values: order.map((p) => p.value) }];
  }

  return {
    ok: true,
    chart: { type, title: spec.title, unit: spec.unit, labels, series },
  };
}

/**
 * Evenly spaced "nice" axis ticks (1/2/2.5/5 × 10^k steps) covering as much
 * of [min, max] as lands on a step multiple. Used for line-chart gridlines.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max < min) [min, max] = [max, min];
  if (max === min) max = min === 0 ? 1 : min + Math.abs(min);
  const rough = (max - min) / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1e6; v += step) {
    // `v === 0` also catches -0 so callers never see a negative zero.
    ticks.push(v === 0 ? 0 : Number(v.toPrecision(12)));
  }
  return ticks;
}

/** Compact, unit-aware value formatting for chart annotations. */
export function formatValue(value: number, unit?: string): string {
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat("en", {
    maximumFractionDigits: abs >= 100 ? 0 : abs >= 1 ? 1 : 2,
    notation: abs >= 10_000 ? "compact" : "standard",
  }).format(value);
  if (!unit) return formatted;
  return unit === "%" ? `${formatted}%` : `${formatted} ${unit}`;
}
