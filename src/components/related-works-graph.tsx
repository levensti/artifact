"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force";
import { Expand, Minimize2 } from "lucide-react";
import type { GraphData, GraphNode, RelationshipType } from "@/lib/explore";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import GraphDetailPanel from "@/components/graph-detail-panel";
import { createReview } from "@/lib/reviews";
import { useRouter } from "next/navigation";

type PositionedNode = GraphNode & { x: number; y: number };

const EDGE_COLORS: Record<RelationshipType, string> = {
  "builds-upon": "#7c6d66",
  extends: "#a07f64",
  "similar-approach": "#8d8c77",
  prerequisite: "#6f7a66",
  "contrasts-with": "#9e6b6b",
  surveys: "#6f7487",
};

function buildLayout(graph: GraphData, width: number, height: number) {
  const layoutNodes = graph.nodes.map((n) => ({ ...n }));
  const links = graph.edges.map((e) => ({ ...e }));

  const sim = forceSimulation(layoutNodes as Array<{ id: string } & GraphNode>)
    .force(
      "link",
      forceLink(links)
        .id((d) => d.id)
        .distance((link) => {
          const target = link.target as GraphNode;
          return target.isCurrent ? 40 : 95;
        }),
    )
    .force("charge", forceManyBody().strength(-260))
    .force("center", forceCenter(width / 2, height / 2))
    .force("collide", forceCollide<GraphNode>().radius((d) => (d.isCurrent ? 44 : 24)))
    .stop();

  for (let i = 0; i < 320; i += 1) sim.tick();
  return layoutNodes as PositionedNode[];
}

function useStaticLayout(graph: GraphData, width: number, height: number) {
  return useMemo(() => buildLayout(graph, width, height), [graph, width, height]);
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
      <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
        {graph.edges.map((edge, index) => {
          const s = nodeMap.get(edge.source);
          const t = nodeMap.get(edge.target);
          if (!s || !t) return null;
          return (
            <g key={`${edge.source}-${edge.target}-${index}`}>
              <path
                d={`M ${s.x} ${s.y} Q ${(s.x + t.x) / 2} ${((s.y + t.y) / 2) - 20} ${t.x} ${t.y}`}
                fill="none"
                stroke={EDGE_COLORS[edge.relationship]}
                strokeOpacity={0.55}
                strokeWidth={1.2}
              />
            </g>
          );
        })}

        {positionedNodes.map((node) => {
          const selected = selectedNodeId === node.id;
          const r = node.isCurrent ? 26 : 14;
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
                y={node.y + (node.isCurrent ? 3 : 4)}
                textAnchor="middle"
                className="select-none pointer-events-none"
                style={{
                  fontSize: node.isCurrent ? "10px" : "8px",
                  fill: node.isCurrent ? "#fff" : "#2d2d2d",
                  fontWeight: node.isCurrent ? 600 : 500,
                }}
              >
                {node.isCurrent
                  ? "Current"
                  : node.title.length > 14
                    ? `${node.title.slice(0, 14)}...`
                    : node.title}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

interface RelatedWorksGraphProps {
  graph: GraphData;
}

export default function RelatedWorksGraph({ graph }: RelatedWorksGraphProps) {
  const router = useRouter();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(graph.nodes[0]?.id ?? null);
  const [expanded, setExpanded] = useState(false);
  const resolvedSelectedNodeId =
    selectedNodeId && graph.nodes.some((n) => n.id === selectedNodeId)
      ? selectedNodeId
      : graph.nodes[0]?.id ?? null;

  const selectedNode =
    graph.nodes.find((node) => node.id === resolvedSelectedNodeId) ?? null;
  const selectedEdge =
    graph.edges.find(
      (edge) =>
        edge.source === graph.nodes.find((n) => n.isCurrent)?.id &&
        edge.target === resolvedSelectedNodeId,
    ) ?? null;

  const onAddToReadingList = (node: GraphNode) => {
    const review = createReview(node.arxivId, node.title);
    router.push(`/review/${review.id}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Keywords: {graph.keywords.join(", ")}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => setExpanded(true)}
        >
          <Expand className="size-3.5 mr-1.5" />
          Expand
        </Button>
      </div>

      <div className="h-[260px]">
        <GraphCanvas
          graph={graph}
          width={760}
          height={420}
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
        edge={selectedEdge}
        onAddToReadingList={onAddToReadingList}
      />

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="max-w-[min(96vw,1300px)] w-[96vw] h-[92vh] p-0 overflow-hidden"
          showCloseButton={false}
        >
          <div className="h-full grid grid-cols-[1fr_340px]">
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
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
              <div className="h-[calc(92vh-5.5rem)]">
                <GraphCanvas
                  graph={graph}
                  width={980}
                  height={760}
                  selectedNodeId={resolvedSelectedNodeId}
                  onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
                />
              </div>
            </div>
            <div className="border-l border-border bg-muted/20 p-4 overflow-y-auto">
              <GraphDetailPanel
                node={selectedNode}
                edge={selectedEdge}
                onAddToReadingList={onAddToReadingList}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
