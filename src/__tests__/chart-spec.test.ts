import { describe, it, expect } from "vitest";
import {
  parseChartSpec,
  formatValue,
  MAX_POINTS,
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

  it("rejects more than MAX_POINTS labels at the schema level", () => {
    const labels = Array.from({ length: MAX_POINTS + 1 }, (_, i) => `L${i}`);
    const values = labels.map((_, i) => i);
    expect(
      parseChartSpec(
        JSON.stringify({ type: "bar", labels, series: [{ values }] }),
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

  it("coerces a pie with too many slices to a bar", () => {
    const labels = Array.from({ length: 10 }, (_, i) => `L${i}`);
    const values = labels.map((_, i) => i + 1);
    const chart = ok(
      JSON.stringify({ type: "pie", labels, series: [{ values }] }),
    );
    expect(chart.type).toBe("bar");
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
