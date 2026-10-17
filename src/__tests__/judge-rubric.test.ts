import { describe, it, expect } from "vitest";
import {
  JUDGE_DIMENSIONS,
  buildJudgeRequest,
  compositeScore,
  orderByJudge,
} from "@/lib/judge-rubric";

describe("JUDGE_DIMENSIONS", () => {
  it("has weights summing to 1 and 2 to 10 levels each", () => {
    const sum = JUDGE_DIMENSIONS.reduce((n, d) => n + d.weight, 0);
    expect(sum).toBeCloseTo(1);
    for (const d of JUDGE_DIMENSIONS) {
      expect(d.criteria.length).toBeGreaterThanOrEqual(2);
      expect(d.criteria.length).toBeLessThanOrEqual(10);
    }
  });
});

describe("buildJudgeRequest", () => {
  it("sends one score question per dimension and the pick as state", () => {
    const body = buildJudgeRequest(
      { question: "How does linear attention work?", projectName: "Efficient transformers" },
      {
        title: "Transformers are RNNs",
        url: "https://arxiv.org/abs/2006.16236",
        rationale: "Introduces linear attention.",
        arxivId: "2006.16236",
        publishedYear: 2020,
      },
      "jev-latest",
    );
    expect(body.model).toBe("jev-latest");
    expect(Object.keys(body.questions)).toEqual(JUDGE_DIMENSIONS.map((d) => d.id));
    expect(body.state).toMatchObject({
      research_question: "How does linear attention work?",
      project: "Efficient transformers",
      source: { title: "Transformers are RNNs", kind: "arXiv paper", year: 2020 },
    });
  });

  it("leaves out empty fields", () => {
    const body = buildJudgeRequest(
      { question: "q" },
      { title: "A post", url: "https://example.com", rationale: "" },
      "jev-latest",
    );
    expect(body.state).not.toHaveProperty("project");
    expect(body.state.source).toEqual({
      title: "A post",
      url: "https://example.com",
      kind: "web source",
    });
  });
});

describe("compositeScore", () => {
  it("is 1 for top marks and 0 for bottom marks", () => {
    const top = Object.fromEntries(
      JUDGE_DIMENSIONS.map((d) => [d.id, { score: d.criteria.length - 1, confidence: 1 }]),
    );
    const bottom = Object.fromEntries(
      JUDGE_DIMENSIONS.map((d) => [d.id, { score: 0, confidence: 1 }]),
    );
    expect(compositeScore(top)).toBeCloseTo(1);
    expect(compositeScore(bottom)).toBeCloseTo(0);
  });

  it("renormalizes over the dimensions that came back", () => {
    expect(compositeScore({ relevance: { score: 2, confidence: 0.5 } })).toBeCloseTo(0.5);
    expect(compositeScore({})).toBeNull();
  });
});

describe("orderByJudge", () => {
  it("puts higher scores first and unscored items last, in their original order", () => {
    const items = [
      { id: "a", s: null },
      { id: "b", s: 0.2 },
      { id: "c", s: 0.9 },
      { id: "d", s: null },
      { id: "e", s: 0.2 },
    ];
    expect(orderByJudge(items, (i) => i.s).map((i) => i.id)).toEqual([
      "c",
      "b",
      "e",
      "a",
      "d",
    ]);
  });
});
