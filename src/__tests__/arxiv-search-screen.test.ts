import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const judge = vi.hoisted(() => ({
  judgeAvailable: vi.fn(() => true),
  judgePicks: vi.fn(),
}));
vi.mock("@/server/judge", () => judge);

import { arxivSearchTool } from "@/tools/arxiv-search";

function s2Paper(id: string, title: string) {
  return {
    paperId: id,
    title,
    abstract: `Abstract of ${title}`,
    authors: [{ name: "A. Author" }],
    year: 2024,
    venue: "NeurIPS",
    citationCount: 10,
    externalIds: { ArXiv: id },
    url: `https://www.semanticscholar.org/paper/${id}`,
  };
}

function score(value: number, credibility = 3) {
  return {
    score: value,
    detail: {
      model: "jev-latest",
      dimensions: { credibility: { score: credibility, confidence: 1 } },
    },
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            s2Paper("2401.00001", "Own paper"),
            s2Paper("2401.00002", "Weak match"),
            s2Paper("2401.00003", "Strong match"),
            s2Paper("2401.00004", "Dubious source"),
            s2Paper("2401.00005", "Good match"),
            s2Paper("2401.00006", "Decent match"),
          ],
        }),
      ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  judge.judgeAvailable.mockReturnValue(true);
  judge.judgePicks.mockReset();
});

describe("arxiv_search relevance screening", () => {
  it("orders by judge score, drops weak hits and the paper itself", async () => {
    judge.judgePicks.mockResolvedValue([
      score(0.2),
      score(0.9),
      score(0.95, 1),
      score(0.7),
      score(0.6),
    ]);
    const out = await arxivSearchTool.execute(
      { query: "diffusion", max_results: 8 },
      { paperTitle: "Own paper", arxivId: "2401.00001v2" },
    );
    expect(typeof out).toBe("string");
    const text = out as string;
    expect(text).toContain("Screened 6 results for relevance");
    expect(text).not.toContain("Own paper");
    expect(text).not.toContain("Weak match");
    expect(text).not.toContain("Dubious source");
    expect(text.indexOf("Strong match")).toBeLessThan(text.indexOf("Good match"));
    expect(text.indexOf("Good match")).toBeLessThan(text.indexOf("Decent match"));
    const [ctx] = judge.judgePicks.mock.calls[0];
    expect(ctx.question).toContain('"Own paper"');
  });

  it("tops up to three results, still skipping low credibility", async () => {
    judge.judgePicks.mockResolvedValue([
      score(0.2),
      score(0.9),
      score(0.95, 1),
      score(0.3),
      score(0.1),
    ]);
    const out = await arxivSearchTool.execute(
      { query: "diffusion" },
      { paperTitle: "Own paper", arxivId: "2401.00001" },
    );
    const text = out as string;
    expect(text).toContain("Found 3 papers");
    expect(text).not.toContain("Dubious source");
    expect(text.indexOf("Strong match")).toBeLessThan(text.indexOf("Good match"));
  });

  it("keeps search order outside a paper chat", async () => {
    const out = await arxivSearchTool.execute({ query: "diffusion" }, {});
    expect(judge.judgePicks).not.toHaveBeenCalled();
    expect(out as string).not.toContain("Screened");
  });

  it("falls back to search order when the judge returns nothing", async () => {
    judge.judgePicks.mockResolvedValue([null, null, null, null, null]);
    const out = await arxivSearchTool.execute(
      { query: "diffusion", max_results: 2 },
      { paperTitle: "Own paper", arxivId: "2401.00001" },
    );
    const text = out as string;
    expect(text).not.toContain("Screened");
    expect(text).toContain("Weak match");
    expect(text).not.toContain("Good match");
  });
});
