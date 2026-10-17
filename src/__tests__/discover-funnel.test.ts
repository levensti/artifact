import { describe, it, expect } from "vitest";
import { parseSearchPlan, shortlist } from "@/server/discover-funnel";

describe("parseSearchPlan", () => {
  it("reads the plan out of a fenced reply", () => {
    const plan = parseSearchPlan(
      'Here you go:\n```json\n{"paper_queries": ["linear attention", "kernel attention survey"], "web_queries": ["a blog post on linear attention"]}\n```',
    );
    expect(plan).toEqual({
      paperQueries: ["linear attention", "kernel attention survey"],
      webQueries: ["a blog post on linear attention"],
    });
  });

  it("drops blanks, duplicates, and non-strings, and caps the counts", () => {
    const plan = parseSearchPlan(
      JSON.stringify({
        paper_queries: ["a", "a", " ", 3, "b", "c", "d", "e", "f", "g", "h", "i"],
        web_queries: ["w"],
      }),
    );
    expect(plan?.paperQueries).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(plan?.webQueries).toEqual(["w"]);
  });

  it("returns null when there's no usable plan", () => {
    expect(parseSearchPlan("I can't help with that.")).toBeNull();
    expect(parseSearchPlan('{"paper_queries": [], "web_queries": []}')).toBeNull();
    expect(parseSearchPlan("{not json}")).toBeNull();
  });
});

describe("shortlist", () => {
  const items = (scores: (number | null)[]) =>
    scores.map((score, i) => ({ id: i, score }));

  it("keeps the top 20 above the floor, best first", () => {
    const scores = Array.from({ length: 30 }, (_, i) => 0.99 - i * 0.01);
    const out = shortlist(items(scores));
    expect(out).toHaveLength(20);
    expect(out[0].score).toBeCloseTo(0.99);
    expect(out.every((c) => (c.score ?? 0) >= 0.5)).toBe(true);
  });

  it("drops candidates below the floor when enough pass", () => {
    const out = shortlist(items([0.9, 0.8, 0.7, 0.6, 0.55, 0.52, 0.51, 0.3, 0.2]));
    expect(out.map((c) => c.score)).toEqual([0.9, 0.8, 0.7, 0.6, 0.55, 0.52, 0.51]);
  });

  it("never shrinks below 6 while candidates remain", () => {
    const out = shortlist(items([0.4, 0.9, 0.1, 0.3, 0.2, 0.35, 0.05]));
    expect(out.map((c) => c.score)).toEqual([0.9, 0.4, 0.35, 0.3, 0.2, 0.1]);
  });

  it("ranks unscored candidates last, in their original order", () => {
    const out = shortlist(items([null, 0.6, null, 0.7]));
    expect(out.map((c) => c.id)).toEqual([3, 1, 0, 2]);
  });
});
