import { describe, it, expect } from "vitest";
import {
  parseChartSpec,
  formatValue,
  niceTicks,
  MAX_CATEGORIES,
  MAX_LINE_POINTS,
} from "@/lib/diagram/chart-spec";

function ok(raw: string) {
  const res = parseChartSpec(raw);
  if (!res.ok) throw new Error(`expected ok, got ${res.reason}`);
  return res.chart;
}

describe("parseChartSpec — valid specs", () => {
  it("parses a single-series bar", () => {
    const chart = ok(
      JSON.stringify({
        type: "bar",
        title: "Latency",
        unit: "ms",
        labels: ["A", "B"],
        series: [{ values: [12, 34] }],
      }),
    );
    expect(chart.type).toBe("bar");
    expect(chart.title).toBe("Latency");
    expect(chart.unit).toBe("ms");
    expect(chart.labels).toEqual(["A", "B"]);
    expect(chart.series).toEqual([{ name: undefined, values: [12, 34] }]);
  });

  it("parses a multi-series line", () => {
    const chart = ok(
      JSON.stringify({
        type: "line",
        labels: ["1B", "7B", "70B"],
        series: [
          { name: "Model X", values: [10, 20, 30] },
          { name: "Model Y", values: [12, 18, 33] },
        ],
      }),
    );
    expect(chart.type).toBe("line");
    expect(chart.series).toHaveLength(2);
  });

  it("parses a pie", () => {
    const chart = ok(
      JSON.stringify({
        type: "pie",
        labels: ["Train", "Val", "Test"],
        series: [{ values: [70, 15, 15] }],
      }),
    );
    expect(chart.type).toBe("pie");
  });

  it("coerces numeric labels to strings", () => {
    const chart = ok(
      JSON.stringify({
        type: "bar",
        labels: [1, 2, 4],
        series: [{ values: [5, 6, 7] }],
      }),
    );
    expect(chart.labels).toEqual(["1", "2", "4"]);
  });
});

describe("parseChartSpec — invalid input", () => {
  it("rejects truncated JSON", () => {
    expect(parseChartSpec('{"type": "bar", "labels": ["A"')).toEqual({
      ok: false,
      reason: "invalid-json",
    });
  });

  it("rejects empty input", () => {
    expect(parseChartSpec("")).toEqual({ ok: false, reason: "invalid-json" });
  });

  it("rescues prose-wrapped JSON via extractJsonSubstring", () => {
    const chart = ok(
      'Here is the chart:\n{"type":"bar","labels":["A"],"series":[{"values":[1]}]}\nDone.',
    );
    expect(chart.labels).toEqual(["A"]);
  });

  it("rejects unknown chart types", () => {
    expect(
      parseChartSpec(
        JSON.stringify({ type: "radar", labels: ["A"], series: [{ values: [1] }] }),
      ),
    ).toEqual({ ok: false, reason: "invalid-spec" });
  });

  it("rejects string values", () => {
    expect(
      parseChartSpec(
        JSON.stringify({
          type: "bar",
          labels: ["A"],
          series: [{ values: ["70%"] }],
        }),
      ),
    ).toEqual({ ok: false, reason: "invalid-spec" });
  });

  it("rejects empty series", () => {
    expect(
      parseChartSpec(JSON.stringify({ type: "bar", labels: ["A"], series: [] })),
    ).toEqual({ ok: false, reason: "invalid-spec" });
  });

  it("rejects non-finite values", () => {
    expect(
      parseChartSpec(
        '{"type":"bar","labels":["A"],"series":[{"values":[null]}]}',
      ),
    ).toEqual({ ok: false, reason: "invalid-spec" });
  });
});

describe("parseChartSpec — normalization", () => {
  it("truncates mismatched lengths to the common minimum", () => {
    const chart = ok(
      JSON.stringify({
        type: "bar",
        labels: ["A", "B", "C"],
        series: [{ values: [1, 2] }],
      }),
    );
    expect(chart.labels).toEqual(["A", "B"]);
    expect(chart.series[0].values).toEqual([1, 2]);
  });

  it("truncates an over-wide bar to the category cap", () => {
    const labels = Array.from({ length: 40 }, (_, i) => `L${i}`);
    const values = labels.map((_, i) => i);
    const chart = ok(
      JSON.stringify({ type: "bar", labels, series: [{ values }] }),
    );
    expect(chart.labels).toHaveLength(MAX_CATEGORIES);
    expect(chart.series[0].values).toHaveLength(MAX_CATEGORIES);
  });

  it("keeps full resolution for a long line", () => {
    // A 60-point training curve must not be truncated like categories are.
    const labels = Array.from({ length: 60 }, (_, i) => `${i}`);
    const values = labels.map((_, i) => Math.sqrt(i));
    const chart = ok(
      JSON.stringify({ type: "line", labels, series: [{ values }] }),
    );
    expect(chart.type).toBe("line");
    expect(chart.labels).toHaveLength(60);
    expect(chart.series[0].values).toHaveLength(60);
  });

  it("rejects beyond the absolute point cap at the schema level", () => {
    const labels = Array.from({ length: MAX_LINE_POINTS + 1 }, (_, i) => `L${i}`);
    const values = labels.map((_, i) => i);
    expect(
      parseChartSpec(
        JSON.stringify({ type: "line", labels, series: [{ values }] }),
      ),
    ).toEqual({ ok: false, reason: "invalid-spec" });
  });

  it("coerces a pie with negative values to a bar", () => {
    const chart = ok(
      JSON.stringify({
        type: "pie",
        labels: ["A", "B"],
        series: [{ values: [5, -3] }],
      }),
    );
    expect(chart.type).toBe("bar");
  });

  it("coerces an all-zero pie to a bar", () => {
    const chart = ok(
      JSON.stringify({
        type: "pie",
        labels: ["A", "B"],
        series: [{ values: [0, 0] }],
      }),
    );
    expect(chart.type).toBe("bar");
  });

  it("folds the smallest slices of an oversized pie into Other", () => {
    // 10 slices valued 1..10: the 7 largest (4..10) survive, 1+2+3 fold.
    const labels = Array.from({ length: 10 }, (_, i) => `L${i}`);
    const values = labels.map((_, i) => i + 1);
    const chart = ok(
      JSON.stringify({ type: "pie", labels, series: [{ values }] }),
    );
    expect(chart.type).toBe("pie");
    expect(chart.labels).toEqual([
      "L3", "L4", "L5", "L6", "L7", "L8", "L9", "Other",
    ]);
    expect(chart.series[0].values).toEqual([4, 5, 6, 7, 8, 9, 10, 6]);
  });

  it("folds into an existing catch-all slice instead of adding a second", () => {
    // "Other" (value 1) is never counted among the kept slices; it absorbs
    // the fold even though L8 (value 2) is smaller than some kept slices.
    const labels = [...Array.from({ length: 9 }, (_, i) => `L${i}`), "Other"];
    const values = [9, 8, 7, 6, 5, 4, 3, 10, 2, 1];
    const chart = ok(
      JSON.stringify({ type: "pie", labels, series: [{ values }] }),
    );
    expect(chart.type).toBe("pie");
    expect(chart.labels).toEqual([
      "L0", "L1", "L2", "L3", "L4", "L5", "L7", "Other",
    ]);
    // Folded: L6 (3) + L8 (2) + Other (1) = 6.
    expect(chart.series[0].values).toEqual([9, 8, 7, 6, 5, 4, 10, 6]);
    // The whole is preserved.
    const total = chart.series[0].values.reduce((a, b) => a + b, 0);
    expect(total).toBe(values.reduce((a, b) => a + b, 0));
  });

  it("leaves a pie at or under the slice cap untouched", () => {
    const labels = Array.from({ length: 8 }, (_, i) => `L${i}`);
    const values = labels.map((_, i) => i + 1);
    const chart = ok(
      JSON.stringify({ type: "pie", labels, series: [{ values }] }),
    );
    expect(chart.type).toBe("pie");
    expect(chart.labels).toEqual(labels);
  });

  it("keeps only the first series of a pie", () => {
    const chart = ok(
      JSON.stringify({
        type: "pie",
        labels: ["A", "B"],
        series: [{ values: [1, 2] }, { values: [3, 4] }],
      }),
    );
    expect(chart.series).toHaveLength(1);
  });

  it("coerces a one-point line to a bar", () => {
    const chart = ok(
      JSON.stringify({
        type: "line",
        labels: ["only"],
        series: [{ values: [42] }],
      }),
    );
    expect(chart.type).toBe("bar");
  });

  it("sorts a single-series bar descending", () => {
    const chart = ok(
      JSON.stringify({
        type: "bar",
        sort: "desc",
        labels: ["A", "B", "C"],
        series: [{ values: [2, 9, 5] }],
      }),
    );
    expect(chart.labels).toEqual(["B", "C", "A"]);
    expect(chart.series[0].values).toEqual([9, 5, 2]);
  });

  it("ignores sort for multi-series bars", () => {
    const chart = ok(
      JSON.stringify({
        type: "bar",
        sort: "desc",
        labels: ["A", "B"],
        series: [{ values: [1, 2] }, { values: [3, 4] }],
      }),
    );
    expect(chart.labels).toEqual(["A", "B"]);
  });
});

describe("niceTicks", () => {
  it("covers a simple 0..100 range", () => {
    expect(niceTicks(0, 100)).toEqual([0, 25, 50, 75, 100]);
  });

  it("rounds to nice steps", () => {
    expect(niceTicks(0, 950)).toEqual([0, 250, 500, 750]);
  });

  it("handles ranges crossing zero without negative zero", () => {
    const ticks = niceTicks(-20, 80);
    expect(ticks).toContain(0);
    expect(ticks.every((t) => !Object.is(t, -0))).toBe(true);
  });

  it("handles a degenerate flat range", () => {
    expect(niceTicks(5, 5).length).toBeGreaterThan(0);
    expect(niceTicks(0, 0).length).toBeGreaterThan(0);
  });

  it("avoids float drift on fractional steps", () => {
    expect(niceTicks(0, 1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe("formatValue", () => {
  it("formats small fractions with two decimals", () => {
    expect(formatValue(0.123)).toBe("0.12");
  });

  it("formats mid-range with one decimal", () => {
    expect(formatValue(7.5, "%")).toBe("7.5%");
  });

  it("formats hundreds with no decimals and grouping", () => {
    expect(formatValue(1234)).toBe("1,234");
  });

  it("compacts large numbers", () => {
    expect(formatValue(52000)).toBe("52K");
  });

  it("handles negatives and zero", () => {
    expect(formatValue(-3.25)).toBe("-3.3");
    expect(formatValue(0)).toBe("0");
  });

  it("space-separates non-percent units", () => {
    expect(formatValue(12, "ms")).toBe("12 ms");
  });
});
