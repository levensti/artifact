"use client";

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import { Maximize2, Minimize2, X } from "lucide-react";
import type { GraphData, GraphEdge, GraphNode, RelationshipType } from "@/lib/explore";
import { RELATIONSHIP_SHORT_LABEL } from "@/lib/explore";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import GraphDetailPanel from "@/components/graph-detail-panel";
import { createOrGetReview } from "@/lib/reviews";
import { useRouter } from "next/navigation";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Max chars shown inside a pill node */
const PILL_CHARS = 26;
const PILL_CHARS_ANCHOR = 32;

/** Approximate char→px for the node font (9px Geist ~5.2px per char) */
const CHAR_W = 5.2;
const PILL_PAD_X = 14;
const PILL_H = 24;
const PILL_H_ANCHOR = 28;
const PILL_RX = 6;

const EDGE_COLORS: Record<RelationshipType, string> = {
  "builds-upon": "#7c6d66",
  extends: "#a07f64",
  "similar-approach": "#8d8c77",
  prerequisite: "#5c6f4d",
  "contrasts-with": "#9e6b6b",
  surveys: "#6f7487",
};

/* ------------------------------------------------------------------ */
/*  Layout helpers                                                     */
/* ------------------------------------------------------------------ */

type PositionedNode = GraphNode & {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
};

type SimNode = GraphNode & SimulationNodeDatum & { w: number; h: number; label: string };

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "\u2026";
}

function pillWidth(label: string): number {
  return label.length * CHAR_W + PILL_PAD_X * 2;
}

function buildLayout(
  graph: GraphData,
  width: number,
  height: number,
  reviewedArxivIds?: Set<string>,
) {
  const layoutNodes: SimNode[] = graph.nodes.map((n) => {
    const isReviewed = reviewedArxivIds?.has(n.arxivId) ?? false;
    const isAnchor = n.isCurrent || isReviewed;
    const maxChars = isAnchor ? PILL_CHARS_ANCHOR : PILL_CHARS;
    const label = truncate(n.title, maxChars);
    const w = pillWidth(label);
    const h = isAnchor ? PILL_H_ANCHOR : PILL_H;
    return { ...n, w, h, label, isCurrent: n.isCurrent || isReviewed };
  });

  const links = graph.edges.map((e) => ({ ...e }));

  const sim = forceSimulation(layoutNodes)
    .force(
      "link",
      forceLink<SimNode, GraphEdge>(links)
        .id((d) => d.id)
        .distance(120),
    )
    .force("charge", forceManyBody<SimNode>().strength(-380))
    .force("center", forceCenter<SimNode>(width / 2, height / 2))
    .force(
      "collide",
      forceCollide<SimNode>().radius((d) => Math.max(d.w, d.h) / 2 + 8),
    )
    .stop();

  for (let i = 0; i < 360; i += 1) sim.tick();
  return layoutNodes as PositionedNode[];
}

function useStaticLayout(
  graph: GraphData,
  width: number,
  height: number,
  reviewedArxivIds?: Set<string>,
) {
  return useMemo(
    () => buildLayout(graph, width, height, reviewedArxivIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, width, height],
  );
}

function incidentEdges(graph: GraphData, nodeId: string | null): GraphEdge[] {
  if (!nodeId) return [];
  const anchorArxiv = graph.nodes.find((n) => n.isCurrent)?.arxivId ?? null;
  const all = graph.edges.filter((e) => e.source === nodeId || e.target === nodeId);
  if (!anchorArxiv) return all;
  const viaAnchor = all.filter((e) => e.source === anchorArxiv || e.target === anchorArxiv);
  return viaAnchor.length > 0 ? viaAnchor : all;
}

/* ------------------------------------------------------------------ */
/*  Edge midpoint for label placement                                  */
/* ------------------------------------------------------------------ */

function quadMid(
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

/* ------------------------------------------------------------------ */
/*  Graph canvas                                                       */
/* ------------------------------------------------------------------ */

interface GraphCanvasProps {
  graph: GraphData;
  width: number;
  height: number;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onDeselectNode: () => void;
  reviewedArxivIds?: Set<string>;
}

function GraphCanvas({
  graph,
  width,
  height,
  selectedNodeId,
  onSelectNode,
  onDeselectNode,
  reviewedArxivIds,
}: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const positionedNodes = useStaticLayout(graph, width, height, reviewedArxivIds);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

  const nodeMap = useMemo(
    () => new Map(positionedNodes.map((n) => [n.id, n])),
    [positionedNodes],
  );

  // Wheel zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scaleDelta = e.deltaY > 0 ? 0.93 : 1.07;
      setTransform((prev) => ({
        ...prev,
        k: Math.max(0.35, Math.min(2.8, prev.k * scaleDelta)),
      }));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
    dragRef.current.x = e.clientX;
    dragRef.current.y = e.clientY;
    setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const handleMouseUp = useCallback(() => {
    const wasDrag = dragRef.current?.moved;
    dragRef.current = null;
    // Click on empty canvas (not drag) deselects
    if (!wasDrag) onDeselectNode();
  }, [onDeselectNode]);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full select-none"
      viewBox={`0 0 ${width} ${height}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { dragRef.current = null; }}
    >
      {/* Background */}
      <defs>
        <pattern id="kgDotGrid" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="0.5" fill="#b8ada4" fillOpacity="0.28" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="#f5f1ee" />
      <rect width={width} height={height} fill="url(#kgDotGrid)" />

      <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
        {/* Edges */}
        {graph.edges.map((edge, index) => {
          const s = nodeMap.get(edge.source);
          const t = nodeMap.get(edge.target);
          if (!s || !t) return null;
          const cx = (s.x + t.x) / 2;
          const cy = (s.y + t.y) / 2 - 24;
          const mid = quadMid(s, t, cx, cy);
          const isIncident =
            selectedNodeId != null &&
            (edge.source === selectedNodeId || edge.target === selectedNodeId);
          const dimmed = selectedNodeId != null && !isIncident;
          return (
            <g key={`e-${edge.source}-${edge.target}-${index}`}>
              <path
                d={`M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`}
                fill="none"
                stroke={EDGE_COLORS[edge.relationship]}
                strokeOpacity={dimmed ? 0.12 : isIncident ? 0.85 : 0.4}
                strokeWidth={isIncident ? 2 : 1.2}
                strokeDasharray={dimmed ? "3 4" : undefined}
              />
              {!dimmed && (
                <text
                  x={mid.x}
                  y={mid.y - 3}
                  textAnchor="middle"
                  className="pointer-events-none"
                  style={{
                    fontSize: 7.5,
                    fill: EDGE_COLORS[edge.relationship],
                    fontWeight: 600,
                    opacity: isIncident ? 1 : 0.72,
                  }}
                >
                  {RELATIONSHIP_SHORT_LABEL[edge.relationship]}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes (pills) */}
        {positionedNodes.map((node) => {
          const selected = selectedNodeId === node.id;
          const hovered = hoverNodeId === node.id;
          const dimmed =
            selectedNodeId != null &&
            !selected &&
            !graph.edges.some(
              (e) =>
                (e.source === selectedNodeId && e.target === node.id) ||
                (e.target === selectedNodeId && e.source === node.id),
            );
          const rx = node.w / 2;
          const ry = node.h / 2;

          return (
            <g
              key={node.id}
              className="cursor-pointer"
              onMouseEnter={() => setHoverNodeId(node.id)}
              onMouseLeave={() => setHoverNodeId(null)}
              onClick={(e) => {
                e.stopPropagation();
                onSelectNode(node.id);
              }}
            >
              {/* Shadow */}
              <rect
                x={node.x - rx}
                y={node.y - ry + 1.5}
                width={node.w}
                height={node.h}
                rx={PILL_RX}
                fill="#28262b"
                fillOpacity={dimmed ? 0.02 : 0.06}
              />
              {/* Pill body */}
              <rect
                x={node.x - rx}
                y={node.y - ry}
                width={node.w}
                height={node.h}
                rx={PILL_RX}
                fill={node.isCurrent ? "#2b2a28" : "#faf7f4"}
                stroke={
                  selected
                    ? "#6b4c36"
                    : hovered
                      ? (node.isCurrent ? "#555" : "#b8ada4")
                      : (node.isCurrent ? "#444" : "#d0c7bf")
                }
                strokeWidth={selected ? 2 : 1}
                opacity={dimmed ? 0.25 : 1}
                style={{
                  transition: "opacity 180ms ease",
                }}
              />
              {/* Label */}
              <text
                x={node.x}
                y={node.y + 3.5}
                textAnchor="middle"
                className="pointer-events-none"
                style={{
                  fontSize: node.isCurrent ? 9.5 : 8.5,
                  fill: dimmed
                    ? "#a9a29c"
                    : node.isCurrent
                      ? "#f0ebe8"
                      : "#3a3836",
                  fontWeight: node.isCurrent ? 600 : 500,
                  letterSpacing: "-0.01em",
                  opacity: dimmed ? 0.4 : 1,
                  transition: "opacity 180ms ease",
                }}
              >
                {node.label}
              </text>
              <title>{node.title}</title>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Legend                                                              */
/* ------------------------------------------------------------------ */

const LEGEND_ORDER: RelationshipType[] = [
  "prerequisite",
  "builds-upon",
  "extends",
  "similar-approach",
  "contrasts-with",
  "surveys",
];

function GraphLegend({ className }: { className?: string }) {
  return (
    <div
      className={`inline-flex flex-wrap gap-x-3.5 gap-y-1 text-[10px] rounded-md border border-border/60 bg-card/80 backdrop-blur-sm px-3 py-2 ${className ?? ""}`}
    >
      {LEGEND_ORDER.map((rel) => (
        <span key={rel} className="inline-flex items-center gap-1.5">
          <span
            className="size-[7px] rounded-full shrink-0"
            style={{ backgroundColor: EDGE_COLORS[rel] }}
          />
          <span className="text-foreground/70 font-medium">
            {RELATIONSHIP_SHORT_LABEL[rel]}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

interface RelatedWorksGraphProps {
  graph: GraphData;
  /** When true, renders full-height immersive layout for the discover page */
  workspace?: boolean;
  onDiscussInChat?: (title: string) => void;
  /** arXiv IDs of papers the user has reviewed — shown as anchor nodes */
  reviewedArxivIds?: Set<string>;
}

export default function RelatedWorksGraph({
  graph,
  workspace = false,
  onDiscussInChat,
  reviewedArxivIds,
}: RelatedWorksGraphProps) {
  const router = useRouter();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const resolvedSelectedNodeId =
    selectedNodeId && graph.nodes.some((n) => n.id === selectedNodeId)
      ? selectedNodeId
      : null;

  const selectedNode =
    graph.nodes.find((node) => node.id === resolvedSelectedNodeId) ?? null;
  const selectedIncident = incidentEdges(graph, resolvedSelectedNodeId);

  const onStartReview = (node: GraphNode) => {
    const review = createOrGetReview(node.arxivId, node.title);
    router.push(`/review/${review.id}`);
  };

  const canvasW = workspace ? 1400 : 760;
  const canvasH = workspace ? 900 : 520;

  /* ---- Compact (in-review) layout ---- */
  if (!workspace) {
    return (
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <GraphLegend />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 className="size-3.5 mr-1.5" />
            Expand
          </Button>
        </div>

        <div className="h-[360px] rounded-md border border-border overflow-hidden">
          <GraphCanvas
            graph={graph}
            width={canvasW}
            height={canvasH}
            selectedNodeId={resolvedSelectedNodeId}
            onSelectNode={setSelectedNodeId}
            onDeselectNode={() => setSelectedNodeId(null)}
            reviewedArxivIds={reviewedArxivIds}
          />
        </div>

        {resolvedSelectedNodeId && (
          <GraphDetailPanel
            node={selectedNode}
            incidentEdges={selectedIncident}
            onStartReview={onStartReview}
            onDiscussInChat={
              onDiscussInChat ? (node) => onDiscussInChat(node.title) : undefined
            }
          />
        )}

        {graph.nodes.length <= 1 && (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            No related papers were found. Re-run analysis to try again.
          </div>
        )}

        {/* Expanded full-screen dialog */}
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent
            className="max-w-[min(96vw,1300px)] w-[96vw] h-[92vh] p-0 overflow-hidden"
            showCloseButton={false}
          >
            <div className="h-full flex">
              <div className="flex-1 flex flex-col min-h-0 p-4">
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <DialogTitle className="text-base font-semibold">
                    Related Works
                  </DialogTitle>
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
                <div className="flex-1 min-h-0 rounded-md border border-border overflow-hidden">
                  <GraphCanvas
                    graph={graph}
                    width={980}
                    height={760}
                    selectedNodeId={resolvedSelectedNodeId}
                    onSelectNode={setSelectedNodeId}
                    onDeselectNode={() => setSelectedNodeId(null)}
                    reviewedArxivIds={reviewedArxivIds}
                  />
                </div>
                <div className="mt-2 shrink-0">
                  <GraphLegend />
                </div>
              </div>
              {resolvedSelectedNodeId && (
                <div className="w-[340px] border-l border-border bg-card/50 p-4 overflow-y-auto">
                  <GraphDetailPanel
                    node={selectedNode}
                    incidentEdges={selectedIncident}
                    onStartReview={onStartReview}
                  />
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  /* ---- Workspace (full-page) layout ---- */
  const showPanel = resolvedSelectedNodeId != null;

  return (
    <div className="flex h-full min-h-0 rounded-lg border border-border overflow-hidden bg-[#f5f1ee]">
      {/* Graph area */}
      <div className="flex-1 min-w-0 relative">
        <GraphCanvas
          graph={graph}
          width={canvasW}
          height={canvasH}
          selectedNodeId={resolvedSelectedNodeId}
          onSelectNode={setSelectedNodeId}
          onDeselectNode={() => setSelectedNodeId(null)}
          reviewedArxivIds={reviewedArxivIds}
        />
        {/* Floating legend */}
        <div className="absolute bottom-3 left-3">
          <GraphLegend />
        </div>
        {/* Hint */}
        <div className="absolute top-3 right-3 text-[10px] text-muted-foreground/60 select-none">
          Scroll to zoom · Drag to pan
        </div>
      </div>

      {/* Slide-in detail panel */}
      {showPanel && (
        <div
          className="w-[320px] shrink-0 border-l border-border bg-card overflow-y-auto"
          style={{ animation: "slideInRight 180ms ease-out" }}
        >
          <div className="flex items-center justify-between p-3 pb-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Details
            </p>
            <button
              type="button"
              className="size-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              onClick={() => setSelectedNodeId(null)}
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="p-3">
            <GraphDetailPanel
              node={selectedNode}
              incidentEdges={selectedIncident}
              onStartReview={onStartReview}
              onDiscussInChat={
                onDiscussInChat ? (node) => onDiscussInChat(node.title) : undefined
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
