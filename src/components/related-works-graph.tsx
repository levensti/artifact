"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import { Expand, Minimize2 } from "lucide-react";
import type { GraphData, GraphEdge, GraphNode, RelationshipType } from "@/lib/explore";
import { RELATIONSHIP_SHORT_LABEL } from "@/lib/explore";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import GraphDetailPanel from "@/components/graph-detail-panel";
import { createOrGetReview } from "@/lib/reviews";
import { useRouter } from "next/navigation";

type PositionedNode = GraphNode & { x: number; y: number };

/** d3-force requires node data to extend SimulationNodeDatum */
type SimNode = GraphNode & SimulationNodeDatum;

const EDGE_COLORS: Record<RelationshipType, string> = {
  "builds-upon": "#7c6d66",
  extends: "#a07f64",
  "similar-approach": "#8d8c77",
  prerequisite: "#5c6f4d",
  "contrasts-with": "#9e6b6b",
  surveys: "#6f7487",
};

function quadBezierMid(
  s: { x: number; y: number },
  t: { x: number; y: number },
  cx: number,
  cy: number,
) {
  return {
    x: 0.25 * s.x + 0.5 * cx + 0.25 * t.x,
    y: 0.25 * s.y + 0.5 * cy + 0.25 * t.y,
  };
}

function buildLayout(graph: GraphData, width: number, height: number) {
  const layoutNodes: SimNode[] = graph.nodes.map((n) => ({ ...n }));
  const links = graph.edges.map((e) => ({ ...e }));
  const hasAnchor = layoutNodes.some((n) => n.isCurrent);

  const sim = forceSimulation(layoutNodes)
    .force(
      "link",
      forceLink<SimNode, GraphEdge>(links)
        .id((d) => d.id)
        .distance(() => (hasAnchor ? 88 : 64)),
    )
    .force("charge", forceManyBody<SimNode>().strength(hasAnchor ? -260 : -320))
    .force("center", forceCenter<SimNode>(width / 2, height / 2))
    .force(
      "collide",
      forceCollide<SimNode>().radius((d) => (hasAnchor && d.isCurrent ? 44 : hasAnchor ? 22 : 24)),
    )
    .stop();

  for (let i = 0; i < 320; i += 1) sim.tick();
  return layoutNodes as PositionedNode[];
}

function useStaticLayout(graph: GraphData, width: number, height: number) {
  return useMemo(() => buildLayout(graph, width, height), [graph, width, height]);
}

function incidentEdges(graph: GraphData, nodeId: string | null): GraphEdge[] {
  if (!nodeId) return [];
  const anchorArxiv = graph.nodes.find((n) => n.isCurrent)?.arxivId ?? null;
  const all = graph.edges.filter((e) => e.source === nodeId || e.target === nodeId);
  if (!anchorArxiv) return all;
  const viaAnchor = all.filter((e) => e.source === anchorArxiv || e.target === anchorArxiv);
  return viaAnchor.length > 0 ? viaAnchor : all;
}

interface GraphCanvasProps {
  graph: GraphData;
  width: number;
  height: number;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

function GraphCanvas({
  graph,
  width,
  height,
  selectedNodeId,
  onSelectNode,
}: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const positionedNodes = useStaticLayout(graph, width, height);
  const [hoverEdgeKey, setHoverEdgeKey] = useState<string | null>(null);

  const nodeMap = useMemo(() => {
    return new Map(positionedNodes.map((n) => [n.id, n]));
  }, [positionedNodes]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scaleDelta = e.deltaY > 0 ? 0.92 : 1.08;
      setTransform((prev) => ({
        ...prev,
        k: Math.max(0.5, Math.min(2.3, prev.k * scaleDelta)),
      }));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full rounded-md border border-border bg-[#faf7f3]"
      viewBox={`0 0 ${width} ${height}`}
      onMouseDown={(e) => {
        dragRef.current = { x: e.clientX, y: e.clientY };
      }}
      onMouseMove={(e) => {
        if (!dragRef.current) return;
        const dx = e.clientX - dragRef.current.x;
        const dy = e.clientY - dragRef.current.y;
        dragRef.current = { x: e.clientX, y: e.clientY };
        setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      }}
      onMouseUp={() => {
        dragRef.current = null;
      }}
      onMouseLeave={() => {
        dragRef.current = null;
      }}
    >
      <defs>
        <pattern id="dotGrid" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.65" fill="#c4b8ae" fillOpacity="0.35" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="url(#dotGrid)" opacity={0.35} />

      <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
        {graph.edges.map((edge, index) => {
          const s = nodeMap.get(edge.source);
          const t = nodeMap.get(edge.target);
          if (!s || !t) return null;
          const cx = (s.x + t.x) / 2;
          const cy = (s.y + t.y) / 2 - 20;
          const mid = quadBezierMid(s, t, cx, cy);
          const ek = `${edge.source}|${edge.target}-${index}`;
          const hover = hoverEdgeKey === ek;
          return (
            <g
              key={`${edge.source}-${edge.target}-${index}`}
              onMouseEnter={() => setHoverEdgeKey(ek)}
              onMouseLeave={() => setHoverEdgeKey(null)}
              style={{ cursor: "default" }}
            >
              <path
                d={`M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`}
                fill="none"
                stroke={EDGE_COLORS[edge.relationship]}
                strokeOpacity={hover ? 0.95 : 0.55}
                strokeWidth={hover ? 2 : 1.35}
              />
              <text
                x={mid.x}
                y={mid.y}
                textAnchor="middle"
                className="pointer-events-none select-none"
                style={{
                  fontSize: hover ? 9 : 8,
                  fill: EDGE_COLORS[edge.relationship],
                  fontWeight: 600,
                  opacity: hover ? 1 : 0.92,
                }}
              >
                {RELATIONSHIP_SHORT_LABEL[edge.relationship]}
              </text>
            </g>
          );
        })}

        {positionedNodes.map((node) => {
          const selected = selectedNodeId === node.id;
          const r = node.isCurrent ? 28 : 16;
          return (
            <g
              key={node.id}
              className="cursor-pointer"
              onClick={() => onSelectNode(node.id)}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={r}
                fill={node.isCurrent ? "#2b2a28" : "#d8cfc7"}
                stroke={selected ? "#8a5f43" : "#a28d7f"}
                strokeWidth={selected ? 3 : 1.2}
              />
              <title>{node.title}</title>
              <text
                x={node.x}
                y={node.y + (node.isCurrent ? 4 : 4)}
                textAnchor="middle"
                className="select-none pointer-events-none"
                style={{
                  fontSize: node.isCurrent ? 10 : 8,
                  fill: node.isCurrent ? "#fff" : "#2d2d2d",
                  fontWeight: node.isCurrent ? 600 : 500,
                }}
              >
                {node.isCurrent
                  ? "Current"
                  : node.title.length > 16
                    ? `${node.title.slice(0, 16)}…`
                    : node.title}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

const LEGEND_ORDER: RelationshipType[] = [
  "prerequisite",
  "builds-upon",
  "extends",
  "similar-approach",
  "contrasts-with",
  "surveys",
];

function GraphLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground px-0.5">
      {LEGEND_ORDER.map((rel) => (
        <span key={rel} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: EDGE_COLORS[rel] }} />
          <span className="text-foreground/85">{RELATIONSHIP_SHORT_LABEL[rel]}</span>
        </span>
      ))}
    </div>
  );
}

interface RelatedWorksGraphProps {
  graph: GraphData;
  workspace?: boolean;
  onDiscussInChat?: (title: string) => void;
}

export default function RelatedWorksGraph({
  graph,
  workspace = false,
  onDiscussInChat,
}: RelatedWorksGraphProps) {
  const router = useRouter();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(graph.nodes[0]?.id ?? null);
  const [expanded, setExpanded] = useState(false);
  const resolvedSelectedNodeId =
    selectedNodeId && graph.nodes.some((n) => n.id === selectedNodeId)
      ? selectedNodeId
      : graph.nodes[0]?.id ?? null;

  const selectedNode =
    graph.nodes.find((node) => node.id === resolvedSelectedNodeId) ?? null;
  const selectedIncident = incidentEdges(graph, resolvedSelectedNodeId);

  const onStartReview = (node: GraphNode) => {
    const review = createOrGetReview(node.arxivId, node.title);
    router.push(`/review/${review.id}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5 flex-1">
          <GraphLegend />
          <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
            Keywords: {graph.keywords.length ? graph.keywords.join(", ") : "—"}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs shrink-0"
          onClick={() => setExpanded(true)}
        >
          <Expand className="size-3.5 mr-1.5" />
          Expand
        </Button>
      </div>

      <div className={workspace ? "h-[540px]" : "h-[360px]"}>
        <GraphCanvas
          graph={graph}
          width={workspace ? 1200 : 760}
          height={workspace ? 760 : 520}
          selectedNodeId={resolvedSelectedNodeId}
          onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
        />
      </div>

      {graph.nodes.length <= 1 && (
        <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          No related papers were found for the extracted keywords. Re-run analysis to try again.
        </div>
      )}

      <GraphDetailPanel
        node={selectedNode}
        incidentEdges={selectedIncident}
        onStartReview={onStartReview}
        onDiscussInChat={onDiscussInChat ? (node) => onDiscussInChat(node.title) : undefined}
      />

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="max-w-[min(96vw,1300px)] w-[96vw] h-[92vh] p-0 overflow-hidden"
          showCloseButton={false}
        >
          <div className="h-full grid grid-cols-[1fr_340px]">
            <div className="p-4 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <DialogTitle>Related Works Graph</DialogTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => setExpanded(false)}
                >
                  <Minimize2 className="size-3.5 mr-1.5" />
                  Collapse
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mb-2 shrink-0">Edge labels match the legend. Pan: drag background. Zoom: scroll.</p>
              <div className="flex-1 min-h-0 pb-2">
                <GraphCanvas
                  graph={graph}
                  width={980}
                  height={760}
                  selectedNodeId={resolvedSelectedNodeId}
                  onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
                />
              </div>
              <GraphLegend />
            </div>
            <div className="border-l border-border bg-muted/20 p-4 overflow-y-auto">
              <GraphDetailPanel
                node={selectedNode}
                incidentEdges={selectedIncident}
                onStartReview={onStartReview}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
