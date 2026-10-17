import { describe, it, expect } from "vitest";
import {
  buildProjectContext,
  projectMaterial,
  withProjectContext,
} from "@/lib/project-research";
import type { DiscoverQuery, Recommendation } from "@/lib/discover-types";
import type { PaperReview, Project } from "@/lib/review-types";

const project: Project = { id: "p1", name: "Efficient transformers", createdAt: "" };

function review(over: Partial<PaperReview>): PaperReview {
  return {
    id: "r",
    title: "Untitled",
    arxivId: null,
    createdAt: "",
    updatedAt: "",
    pdfPath: null,
    sourceUrl: null,
    projectId: "p1",
    ...over,
  };
}

function query(over: Partial<DiscoverQuery>): DiscoverQuery {
  return {
    id: "q",
    query: "",
    notes: null,
    status: "complete",
    createdAt: "2026-10-01T00:00:00Z",
    projectId: "p1",
    ...over,
  };
}

function rec(over: Partial<Recommendation>): Recommendation {
  return {
    id: "x",
    queryId: "q1",
    rank: 1,
    url: "",
    title: "",
    rationale: "",
    arxivId: null,
    authors: null,
    publishedDate: null,
    publishedYear: null,
    venue: null,
    citationCount: null,
    judgeScore: null,
    judgeDetail: null,
    dismissedAt: null,
    createdAt: "",
    ...over,
  };
}

describe("projectMaterial", () => {
  it("keeps only the project's reviews, briefs, and their picks", () => {
    const m = projectMaterial(
      project,
      [review({ id: "a" }), review({ id: "b", projectId: "other" })],
      [query({ id: "q1" }), query({ id: "q2", projectId: null })],
      [rec({ id: "1", queryId: "q1" }), rec({ id: "2", queryId: "q2" })],
    );
    expect(m.reviews.map((r) => r.id)).toEqual(["a"]);
    expect(m.queries.map((q) => q.id)).toEqual(["q1"]);
    expect(m.recommendations.map((r) => r.id)).toEqual(["1"]);
  });
});

describe("buildProjectContext", () => {
  it("lists earlier questions and every known source once", () => {
    const text = buildProjectContext({
      project,
      reviews: [review({ title: "Attention Is All You Need", arxivId: "1706.03762v7" })],
      queries: [query({ query: "How does linear attention work?" })],
      recommendations: [
        // Same paper as the review: listed once.
        rec({ title: "Attention Is All You Need", arxivId: "1706.03762" }),
        rec({ title: "A blog post", url: "https://example.com/post", rank: 2 }),
      ],
    });
    expect(text).toContain('project "Efficient transformers"');
    expect(text).toContain("- How does linear attention work?");
    expect(text).toContain("Do NOT recommend any of them again");
    expect(text.match(/arXiv:1706\.03762/g)).toHaveLength(1);
    expect(text).toContain("- A blog post (https://example.com/post)");
  });

  it("skips the source list for an empty project", () => {
    const text = buildProjectContext({
      project,
      reviews: [],
      queries: [],
      recommendations: [],
    });
    expect(text).not.toContain("Do NOT recommend");
  });
});

describe("withProjectContext", () => {
  it("puts the context before the question", () => {
    const out = withProjectContext("What about state space models?", {
      project,
      reviews: [],
      queries: [],
      recommendations: [],
    });
    expect(out.indexOf("Efficient transformers")).toBeLessThan(
      out.indexOf("What about state space models?"),
    );
  });
});
