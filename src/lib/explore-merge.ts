import type {
  GlobalGraphData,
  GraphData,
  GraphEdge,
  GraphNode,
} from "@/lib/explore";

function edgeKeyDirected(e: GraphEdge): string {
  return `${e.source}→${e.target}:${e.relationship}`;
}

/** Pure merge of a session graph into the cross-review knowledge map. */
export function mergeGlobalGraphSession(
  anchorReviewId: string,
  graph: GraphData,
  existing: GlobalGraphData | null,
): GlobalGraphData {
  const base =
    existing ??
    ({
      nodes: [],
      edges: [],
      updatedAt: new Date().toISOString(),
    } satisfies GlobalGraphData);

  const nodeByArxiv = new Map<string, GraphNode>();
  for (const n of base.nodes) {
    nodeByArxiv.set(n.arxivId, { ...n, id: n.arxivId, isCurrent: false });
  }

  for (const n of graph.nodes) {
    const merged: GraphNode = {
      ...n,
      id: n.arxivId,
      isCurrent: false,
    };
    const prev = nodeByArxiv.get(n.arxivId);
    if (
      !prev ||
      (merged.abstract?.length ?? 0) > (prev.abstract?.length ?? 0) ||
      (merged.title?.length ?? 0) > (prev.title?.length ?? 0)
    ) {
      nodeByArxiv.set(n.arxivId, merged);
    }
  }

  const edgeMap = new Map<string, GlobalGraphData["edges"][number]>();
  for (const e of base.edges) {
    edgeMap.set(edgeKeyDirected(e), e);
  }

  for (const e of graph.edges) {
    const k = edgeKeyDirected(e);
    const prev = edgeMap.get(k);
    if (!prev) {
      edgeMap.set(k, { ...e, sourceReviewIds: [anchorReviewId] });
    } else if (!prev.sourceReviewIds.includes(anchorReviewId)) {
      edgeMap.set(k, {
        ...prev,
        reasoning:
          prev.reasoning.length >= e.reasoning.length
            ? prev.reasoning
            : e.reasoning,
        sourceReviewIds: [...prev.sourceReviewIds, anchorReviewId],
      });
    }
  }

  return {
    nodes: [...nodeByArxiv.values()],
    edges: [...edgeMap.values()],
    updatedAt: new Date().toISOString(),
  };
}
