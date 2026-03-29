/**
 * ReactFlow node/edge builders for the knowledge graph.
 *
 * Builds the typed Node[] and Edge[] arrays that ReactFlow consumes,
 * applying selection, search, and highlight state.
 */

import type { Edge, Node } from "@xyflow/react";
import type { GraphData, GraphEdge, RelationshipType } from "@/lib/explore";
import { RELATIONSHIP_SHORT_LABEL } from "@/lib/explore";
import { paperMatchesQuery, type PositionedNode } from "./graph-layout";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const EDGE_COLORS: Record<RelationshipType, string> = {
  "builds-upon": "#7c6d66",
  extends: "#a07f64",
  "similar-approach": "#8d8c77",
  prerequisite: "#5c6f4d",
  "contrasts-with": "#9e6b6b",
};

export function isRenderableRelationship(rel: string): rel is RelationshipType {
  return rel in EDGE_COLORS;
}

/* ------------------------------------------------------------------ */
/*  Node builder                                                       */
/* ------------------------------------------------------------------ */

export function buildFlowNodes(
  graph: GraphData,
  positionedNodes: PositionedNode[],
  selectedNodeId: string | null,
  hoverNodeId: string | null,
  searchQuery: string,
  highlightedNodeIds?: Set<string>,
): Node[] {
  const q = searchQuery.trim();
  const searchOn = q.length > 0;

  return positionedNodes.map((node) => {
    const selected = selectedNodeId === node.id;
    const hovered = hoverNodeId === node.id;
    const matches = paperMatchesQuery(node, q);
    const searchMatch = searchOn && matches;
    const fresh = highlightedNodeIds?.has(node.id) ?? false;

    const selectionDimmed =
      !searchOn &&
      selectedNodeId != null &&
      !selected &&
      !graph.edges.some(
        (e) =>
          (e.source === selectedNodeId && e.target === node.id) ||
          (e.target === selectedNodeId && e.source === node.id),
      );

    const searchDimmed = searchOn && !matches;
    const dimmed = selectionDimmed || searchDimmed;

    return {
      id: node.id,
      type: "paper",
      position: { x: node.x - node.w / 2, y: node.y - node.h / 2 },
      selected,
      style: { width: node.w, height: node.h },
      data: {
        label: node.label,
        title: node.title,
        isAnchor: node.isCurrent,
        dimmed,
        hovered,
        searchMatch,
        fresh,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Edge builder                                                       */
/* ------------------------------------------------------------------ */

export function buildFlowEdges(
  graph: GraphData,
  selectedNodeId: string | null,
  searchQuery: string,
): Edge[] {
  const q = searchQuery.trim();
  const searchOn = q.length > 0;

  return graph.edges
    .filter((edge) => isRenderableRelationship(edge.relationship))
    .map((edge, index) => {
      const sNode = graph.nodes.find((n) => n.id === edge.source);
      const tNode = graph.nodes.find((n) => n.id === edge.target);

      const edgeTouchesSearch =
        searchOn &&
        sNode &&
        tNode &&
        (paperMatchesQuery(sNode, q) || paperMatchesQuery(tNode, q));

      const isIncident =
        !searchOn &&
        selectedNodeId != null &&
        (edge.source === selectedNodeId || edge.target === selectedNodeId);

      const incident = searchOn ? edgeTouchesSearch : isIncident;
      const dimmed = searchOn ? !edgeTouchesSearch : selectedNodeId != null && !isIncident;

      const color = EDGE_COLORS[edge.relationship];
      return {
        id: `e-${edge.source}-${edge.target}-${index}`,
        source: edge.source,
        target: edge.target,
        sourceHandle: "s",
        targetHandle: "t",
        type: "relationship",
        data: {
          label: RELATIONSHIP_SHORT_LABEL[edge.relationship],
          color,
          dimmed,
          incident,
        },
      };
    });
}

/* ------------------------------------------------------------------ */
/*  Incident edges helper                                              */
/* ------------------------------------------------------------------ */

export function incidentEdges(graph: GraphData, nodeId: string | null): GraphEdge[] {
  if (!nodeId) return [];
  const anchorArxiv = graph.nodes.find((n) => n.isCurrent)?.arxivId ?? null;
  const all = graph.edges.filter(
    (e) =>
      isRenderableRelationship(e.relationship) &&
      (e.source === nodeId || e.target === nodeId),
  );
  if (!anchorArxiv) return all;
  const viaAnchor = all.filter((e) => e.source === anchorArxiv || e.target === anchorArxiv);
  return viaAnchor.length > 0 ? viaAnchor : all;
}
