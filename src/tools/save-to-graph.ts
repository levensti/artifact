/**
 * Tool: save_to_knowledge_graph
 *
 * Persists related papers discovered during chat into the per-review
 * knowledge graph and merges them into the global cross-review graph.
 * This lets the assistant "remember" related works it finds so they
 * appear in the Discovery tab's graph visualization.
 */

import type { ToolDefinition, ToolContext } from "./types";
import type {
  GraphData,
  GraphEdge,
  GraphNode,
  RelationshipType,
} from "@/lib/explore";
import {
  getGraphData,
  setGraphData,
  getGlobalGraphData,
  setGlobalGraphData,
} from "@/lib/server/store";
import { mergeGlobalGraphSession } from "@/lib/explore-merge";

const VALID_RELATIONSHIPS = new Set<RelationshipType>([
  "builds-upon",
  "extends",
  "similar-approach",
  "prerequisite",
  "contrasts-with",
]);

interface PaperInput {
  arxiv_id: string;
  title: string;
  authors?: string[];
  abstract?: string;
  relationship: string;
  reasoning: string;
}

export const saveToGraphTool: ToolDefinition = {
  name: "save_to_knowledge_graph",
  description:
    "Save related papers you've found to the knowledge graph so the user can visualize and revisit them later in the Discovery tab. " +
    "Use this after finding relevant papers via arxiv_search — it persists the relationships (prerequisite, builds-upon, extends, similar-approach, contrasts-with) " +
    "between the current paper and the related papers you discovered. Papers are merged into both the per-review graph and the global cross-review knowledge graph.",
  parameters: {
    type: "object",
    properties: {
      papers: {
        type: "array",
        description:
          'Array of related papers to save. Each must have: arxiv_id (string), title (string), relationship (one of: "prerequisite", "builds-upon", "extends", "similar-approach", "contrasts-with"), reasoning (one sentence explaining the relationship). Optional: authors (string[]), abstract (string).',
        items: { type: "object" },
      },
    },
    required: ["papers"],
  },

  async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const reviewId = context.reviewId;
    const arxivId = context.arxivId;
    const paperTitle = context.paperTitle;

    if (!reviewId) {
      return "Error: no review context — cannot save to knowledge graph.";
    }
    if (!arxivId) {
      return "Error: no arXiv ID for the current paper — cannot save to knowledge graph.";
    }

    const rawPapers = input.papers;
    if (!Array.isArray(rawPapers) || rawPapers.length === 0) {
      return "Error: papers array is required and must not be empty.";
    }

    // Validate and normalize input papers
    const papers: PaperInput[] = [];
    for (const p of rawPapers) {
      if (!p || typeof p !== "object") continue;
      const obj = p as Record<string, unknown>;
      const id = String(obj.arxiv_id ?? obj.arxivId ?? "").trim();
      const title = String(obj.title ?? "").trim();
      const relationship = String(
        obj.relationship ?? "",
      ).trim() as RelationshipType;
      const reasoning = String(obj.reasoning ?? "").trim();

      if (!id || !title) continue;
      if (!VALID_RELATIONSHIPS.has(relationship)) continue;

      papers.push({
        arxiv_id: id,
        title,
        authors: Array.isArray(obj.authors)
          ? (obj.authors as string[]).map(String)
          : [],
        abstract: typeof obj.abstract === "string" ? obj.abstract : "",
        relationship,
        reasoning,
      });
    }

    if (papers.length === 0) {
      return "Error: no valid papers to save. Each paper needs arxiv_id, title, a valid relationship type, and reasoning.";
    }

    // Load existing graph or create a new one
    const existing = getGraphData(reviewId);

    const currentNode: GraphNode = existing?.nodes.find((n) => n.isCurrent) ?? {
      id: arxivId,
      title: paperTitle ?? "Current paper",
      authors: [],
      abstract: "",
      arxivId,
      publishedDate: new Date().toISOString(),
      categories: [],
      isCurrent: true,
    };

    // Build maps of existing nodes/edges for dedup
    const nodeMap = new Map<string, GraphNode>();
    if (existing) {
      for (const n of existing.nodes) nodeMap.set(n.arxivId, n);
    }
    nodeMap.set(currentNode.arxivId, currentNode);

    const edgeSet = new Set<string>();
    const edges: GraphEdge[] = [];
    if (existing) {
      for (const e of existing.edges) {
        const key = `${e.source}→${e.target}:${e.relationship}`;
        edgeSet.add(key);
        edges.push(e);
      }
    }

    let added = 0;
    for (const p of papers) {
      // Skip self-references
      if (p.arxiv_id === arxivId) continue;

      // Add or update node
      if (!nodeMap.has(p.arxiv_id)) {
        nodeMap.set(p.arxiv_id, {
          id: p.arxiv_id,
          title: p.title,
          authors: p.authors ?? [],
          abstract: p.abstract ?? "",
          arxivId: p.arxiv_id,
          publishedDate: "",
          categories: [],
          isCurrent: false,
        });
      }

      // Add edge if not duplicate
      const edgeKey = `${arxivId}→${p.arxiv_id}:${p.relationship}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        edges.push({
          source: arxivId,
          target: p.arxiv_id,
          relationship: p.relationship as RelationshipType,
          reasoning: p.reasoning,
        });
        added++;
      }
    }

    const graph: GraphData = {
      nodes: [...nodeMap.values()],
      edges,
      keywords: existing?.keywords ?? [],
      generatedAt: new Date().toISOString(),
      modelUsed: existing?.modelUsed ?? "assistant",
      anchorReviewId: reviewId,
    };

    // Persist per-review graph
    setGraphData(reviewId, graph);

    // Merge into global graph
    const globalGraph = getGlobalGraphData();
    const merged = mergeGlobalGraphSession(reviewId, graph, globalGraph);
    setGlobalGraphData(merged);

    const total = graph.nodes.length - 1; // exclude current paper
    return `Saved ${added} new relationship${added !== 1 ? "s" : ""} to the knowledge graph (${total} related paper${total !== 1 ? "s" : ""} total).\n\n[Open Discover](/discovery) to view the updated graph.`;
  },
};
