import { describe, it, expect } from "vitest";
import { mergeGlobalGraphSession } from "@/lib/explore-merge";
import type { GlobalGraphData, GraphData } from "@/lib/explore";

function makeGraphData(overrides: Partial<GraphData> = {}): GraphData {
  return {
    nodes: [],
    edges: [],
    keywords: [],
    generatedAt: "2024-01-01T00:00:00Z",
    modelUsed: "test",
    ...overrides,
  };
}

describe("mergeGlobalGraphSession", () => {
  it("creates a new global graph from scratch", () => {
    const session = makeGraphData({
      nodes: [
        {
          id: "n1",
          title: "Paper A",
          authors: ["Alice"],
          abstract: "Abstract A",
          arxivId: "2301.00001",
          publishedDate: "2023-01-01",
          categories: ["cs.LG"],
          isCurrent: true,
        },
      ],
      edges: [],
    });

    const result = mergeGlobalGraphSession("review-1", session, null);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].arxivId).toBe("2301.00001");
    expect(result.nodes[0].isCurrent).toBe(false); // global graph clears isCurrent
    expect(result.edges).toHaveLength(0);
  });

  it("merges nodes by arxivId without duplicates", () => {
    const existing: GlobalGraphData = {
      nodes: [
        {
          id: "2301.00001",
          title: "Paper A",
          authors: [],
          abstract: "Short",
          arxivId: "2301.00001",
          publishedDate: "2023-01-01",
          categories: [],
          isCurrent: false,
        },
      ],
      edges: [],
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const session = makeGraphData({
      nodes: [
        {
          id: "2301.00001",
          title: "Paper A (Updated)",
          authors: ["Alice"],
          abstract: "A much longer abstract than before",
          arxivId: "2301.00001",
          publishedDate: "2023-01-01",
          categories: ["cs.LG"],
          isCurrent: true,
        },
        {
          id: "2301.00002",
          title: "Paper B",
          authors: [],
          abstract: "Abstract B",
          arxivId: "2301.00002",
          publishedDate: "2023-02-01",
          categories: [],
          isCurrent: false,
        },
      ],
    });

    const result = mergeGlobalGraphSession("review-1", session, existing);

    expect(result.nodes).toHaveLength(2);
    // Should pick the version with longer abstract
    const nodeA = result.nodes.find((n) => n.arxivId === "2301.00001")!;
    expect(nodeA.abstract).toBe("A much longer abstract than before");
  });

  it("merges edges and tracks source review IDs", () => {
    const existing: GlobalGraphData = {
      nodes: [
        { id: "a1", title: "A", authors: [], abstract: "", arxivId: "a1", publishedDate: "", categories: [], isCurrent: false },
        { id: "a2", title: "B", authors: [], abstract: "", arxivId: "a2", publishedDate: "", categories: [], isCurrent: false },
      ],
      edges: [
        { source: "a1", target: "a2", relationship: "builds-upon", reasoning: "R1", sourceReviewIds: ["r1"] },
      ],
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const session = makeGraphData({
      nodes: existing.nodes,
      edges: [
        { source: "a1", target: "a2", relationship: "builds-upon", reasoning: "R2" },
      ],
    });

    const result = mergeGlobalGraphSession("r2", session, existing);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].sourceReviewIds).toEqual(["r1", "r2"]);
  });

  it("does not duplicate review IDs on re-merge", () => {
    const existing: GlobalGraphData = {
      nodes: [],
      edges: [
        { source: "a", target: "b", relationship: "extends", reasoning: "reason", sourceReviewIds: ["r1"] },
      ],
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const session = makeGraphData({
      edges: [{ source: "a", target: "b", relationship: "extends", reasoning: "reason" }],
    });

    const result = mergeGlobalGraphSession("r1", session, existing);
    expect(result.edges[0].sourceReviewIds).toEqual(["r1"]);
  });

  it("adds new edge types between same nodes", () => {
    const existing: GlobalGraphData = {
      nodes: [],
      edges: [
        { source: "a", target: "b", relationship: "builds-upon", reasoning: "R1", sourceReviewIds: ["r1"] },
      ],
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const session = makeGraphData({
      edges: [
        { source: "a", target: "b", relationship: "similar-approach", reasoning: "R2" },
      ],
    });

    const result = mergeGlobalGraphSession("r2", session, existing);
    expect(result.edges).toHaveLength(2);
  });
});
