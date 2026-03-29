"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize2, Minimize2, Search, X } from "lucide-react";
import type { GraphData, GraphEdge, GraphNode, RelationshipType } from "@/lib/explore";
import { RELATIONSHIP_SHORT_LABEL } from "@/lib/explore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import GraphDetailPanel from "@/components/graph-detail-panel";
import { PaperNode } from "@/components/knowledge-graph-node";
import { RelationshipEdge } from "@/components/knowledge-graph-edge";
import { cn } from "@/lib/utils";
import { createOrGetReview, normalizeArxivId } from "@/lib/reviews";
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

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "\u2026";
}

function pillWidth(label: string): number {
  return label.length * CHAR_W + PILL_PAD_X * 2;
}

/** Max satellites on a circle of radius r without chord length dropping below `need` (px). */
function maxNodesOnRing(r: number, need: number): number {
  if (r < 8 || need <= 0) return 1;
  if (2 * r <= need) return 1;
  let lo = 1;
  let hi = 256;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    const chord = 2 * r * Math.sin(Math.PI / mid);
    if (chord >= need) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(1, lo);
}

/** Push overlapping pill centers apart (circle bounds using max(w,h)). */
function paperMatchesQuery(node: GraphNode, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  return (
    node.title.toLowerCase().includes(q) ||
    node.arxivId.toLowerCase().includes(q)
  );
}

function resolveOverlaps(nodes: PositionedNode[], iterations = 140) {
  const pad = 10;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const ra = Math.max(a.w, a.h) / 2 + pad;
        const rb = Math.max(b.w, b.h) / 2 + pad;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = ra + rb;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
  }
}

/**
 * Radial layout: anchor at center, satellites on expanding rings. Ring capacity
 * scales with circumference (chord spacing vs pill width) so we never stack
 * too many nodes on one circle. Radii always increase — we never clamp multiple
 * rings to the same radius (that was causing the “pile in the middle” mess).
 */
function buildRadialLayout(
  graph: GraphData,
  width: number,
  height: number,
  reviewedArxivIds?: Set<string>,
): PositionedNode[] {
  const layoutNodes: PositionedNode[] = graph.nodes.map((n) => {
    const isReviewed =
      reviewedArxivIds?.has(normalizeArxivId(n.arxivId)) ?? false;
    const isAnchor = n.isCurrent || isReviewed;
    const maxChars = isAnchor ? PILL_CHARS_ANCHOR : PILL_CHARS;
    const label = truncate(n.title, maxChars);
    const w = pillWidth(label);
    const h = isAnchor ? PILL_H_ANCHOR : PILL_H;
    return { ...n, w, h, label, isCurrent: n.isCurrent || isReviewed, x: 0, y: 0 };
  });

  const cx = width / 2;
  const cy = height / 2;

  if (layoutNodes.length === 0) return [];

  const anchor =
    layoutNodes.find((n) => n.isCurrent) ??
    layoutNodes.find((n) =>
      reviewedArxivIds?.has(normalizeArxivId(n.arxivId)),
    ) ??
    layoutNodes[0];

  const others = layoutNodes.filter((n) => n.id !== anchor.id);

  anchor.x = cx;
  anchor.y = cy;

  if (others.length === 0) {
    return layoutNodes;
  }

  const maxW = Math.max(anchor.w, ...others.map((n) => n.w));
  const gap = 16;
  const need = maxW + gap;

  let idx = 0;
  let r = Math.max(need * 0.55, 88);

  while (idx < others.length) {
    const cap = maxNodesOnRing(r, need);
    const count = Math.min(cap, others.length - idx);
    const slice = others.slice(idx, idx + count);
    slice.forEach((node, j) => {
      const angle = (2 * Math.PI * j) / slice.length - Math.PI / 2;
      node.x = cx + r * Math.cos(angle);
      node.y = cy + r * Math.sin(angle);
    });
    idx += count;
    if (idx >= others.length) break;
    r += Math.max(44, maxW * 0.42 + gap);
  }

  resolveOverlaps(layoutNodes, 160);

  return layoutNodes;
}

function useStaticLayout(
  graph: GraphData,
  width: number,
  height: number,
  reviewedArxivIds?: Set<string>,
) {
  return useMemo(
    () => buildRadialLayout(graph, width, height, reviewedArxivIds),
    [graph, width, height, reviewedArxivIds],
  );
}

const nodeTypes = { paper: PaperNode };
const edgeTypes = { relationship: RelationshipEdge };

function buildFlowNodes(
  graph: GraphData,
  positionedNodes: PositionedNode[],
  selectedNodeId: string | null,
  hoverNodeId: string | null,
  searchQuery: string,
): Node[] {
  const q = searchQuery.trim();
  const searchOn = q.length > 0;

  return positionedNodes.map((node) => {
    const selected = selectedNodeId === node.id;
    const hovered = hoverNodeId === node.id;
    const matches = paperMatchesQuery(node, q);
    const searchMatch = searchOn && matches;

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
      },
    };
  });
}

function buildFlowEdges(
  graph: GraphData,
  selectedNodeId: string | null,
  searchQuery: string,
): Edge[] {
  const q = searchQuery.trim();
  const searchOn = q.length > 0;

  return graph.edges.map((edge, index) => {
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

function incidentEdges(graph: GraphData, nodeId: string | null): GraphEdge[] {
  if (!nodeId) return [];
  const anchorArxiv = graph.nodes.find((n) => n.isCurrent)?.arxivId ?? null;
  const all = graph.edges.filter((e) => e.source === nodeId || e.target === nodeId);
  if (!anchorArxiv) return all;
  const viaAnchor = all.filter((e) => e.source === anchorArxiv || e.target === anchorArxiv);
  return viaAnchor.length > 0 ? viaAnchor : all;
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
  /** Case-insensitive substring on title and arXiv id */
  searchQuery: string;
}

const FIT_VIEW_OPTIONS = {
  padding: 0.08,
  maxZoom: 1.75,
  minZoom: 0.4,
} as const;

function FitViewWhenGraphChanges({ graphKey }: { graphKey: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    fitView(FIT_VIEW_OPTIONS);
  }, [graphKey, fitView]);
  return null;
}

function GraphCanvasInner({
  graph,
  width,
  height,
  selectedNodeId,
  onSelectNode,
  onDeselectNode,
  reviewedArxivIds,
  searchQuery,
}: GraphCanvasProps) {
  const positionedNodes = useStaticLayout(graph, width, height, reviewedArxivIds);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

  const flowNodes = useMemo(
    () =>
      buildFlowNodes(
        graph,
        positionedNodes,
        selectedNodeId,
        hoverNodeId,
        searchQuery,
      ),
    [graph, positionedNodes, selectedNodeId, hoverNodeId, searchQuery],
  );

  const flowEdges = useMemo(
    () => buildFlowEdges(graph, selectedNodeId, searchQuery),
    [graph, selectedNodeId, searchQuery],
  );

  const [nodes, setNodes] = useNodesState(flowNodes);
  const [edges, setEdges] = useEdgesState(flowEdges);

  useEffect(() => {
    setNodes(flowNodes);
  }, [flowNodes, setNodes]);

  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [setEdges],
  );

  const graphKey = `${graph.generatedAt}-${graph.nodes.length}-${graph.edges.length}`;

  return (
    <div
      style={{ width, height }}
      className="relative overflow-hidden rounded-md bg-linear-to-br from-background via-card/50 to-muted/30"
    >
      <ReactFlow
        key={graphKey}
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll={false}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        panOnDrag
        minZoom={0.35}
        maxZoom={2.8}
        onInit={(instance) => {
          instance.fitView(FIT_VIEW_OPTIONS);
        }}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onDeselectNode()}
        onNodeMouseEnter={(_, node) => setHoverNodeId(node.id)}
        onNodeMouseLeave={() => setHoverNodeId(null)}
        proOptions={{ hideAttribution: true }}
        className="bg-transparent!"
      >
        <FitViewWhenGraphChanges graphKey={graphKey} />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--border)"
          className="opacity-[0.38]"
        />
      </ReactFlow>
    </div>
  );
}

function GraphCanvas(props: GraphCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => ({ w: props.width, h: props.height }));

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const rw = Math.round(r.width);
      const rh = Math.round(r.height);
      const w = rw > 12 ? rw : props.width;
      const h = rh > 12 ? rh : props.height;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.width, props.height]);

  return (
    <div ref={wrapRef} className="h-full w-full min-h-[200px] min-w-0">
      <ReactFlowProvider>
        <GraphCanvasInner
          graph={props.graph}
          width={size.w}
          height={size.h}
          selectedNodeId={props.selectedNodeId}
          onSelectNode={props.onSelectNode}
          onDeselectNode={props.onDeselectNode}
          reviewedArxivIds={props.reviewedArxivIds}
          searchQuery={props.searchQuery}
        />
      </ReactFlowProvider>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Search                                                              */
/* ------------------------------------------------------------------ */

function GraphPaperSearch({
  value,
  onChange,
  matchCount,
  total,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  matchCount: number;
  total: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex w-full min-w-0 max-w-sm items-center gap-2",
        className,
      )}
    >
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        aria-label="Search papers by title or arXiv id"
        placeholder="Search papers…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full min-w-0 border-border/80 bg-card/90 pl-8 backdrop-blur-sm"
      />
      {value.trim() ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {matchCount}/{total}
        </span>
      ) : null}
    </div>
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
  /** When true, renders a larger graph canvas (reserved for full-page layouts). */
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
  const [paperSearch, setPaperSearch] = useState("");

  const searchMatchCount = useMemo(
    () => graph.nodes.filter((n) => paperMatchesQuery(n, paperSearch)).length,
    [graph.nodes, paperSearch],
  );

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

  /** Compact coordinate space; viewport is filled via fitView (no pan/zoom UI). */
  const canvasW = workspace ? 560 : 520;
  const canvasH = workspace ? 380 : 320;

  /* ---- Compact (in-review) layout ---- */
  if (!workspace) {
    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <GraphLegend />
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <GraphPaperSearch
              value={paperSearch}
              onChange={setPaperSearch}
              matchCount={searchMatchCount}
              total={graph.nodes.length}
              className="sm:max-w-[14rem]"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 self-start text-xs sm:self-center"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 className="size-3.5 mr-1.5" />
              Expand
            </Button>
          </div>
        </div>

        <div className="h-[360px] rounded-md border border-border overflow-hidden min-h-0">
          <GraphCanvas
            graph={graph}
            width={canvasW}
            height={canvasH}
            selectedNodeId={resolvedSelectedNodeId}
            onSelectNode={setSelectedNodeId}
            onDeselectNode={() => setSelectedNodeId(null)}
            reviewedArxivIds={reviewedArxivIds}
            searchQuery={paperSearch}
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
                <div className="mb-2 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <DialogTitle className="text-base font-semibold">
                    Related Works
                  </DialogTitle>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:justify-end">
                    <GraphPaperSearch
                      value={paperSearch}
                      onChange={setPaperSearch}
                      matchCount={searchMatchCount}
                      total={graph.nodes.length}
                      className="min-w-[12rem] flex-1 sm:max-w-[16rem]"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0 text-xs"
                      onClick={() => setExpanded(false)}
                    >
                      <Minimize2 className="size-3.5 mr-1.5" />
                      Collapse
                    </Button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 rounded-md border border-border overflow-hidden">
                  <GraphCanvas
                    graph={graph}
                    width={600}
                    height={400}
                    selectedNodeId={resolvedSelectedNodeId}
                    onSelectNode={setSelectedNodeId}
                    onDeselectNode={() => setSelectedNodeId(null)}
                    reviewedArxivIds={reviewedArxivIds}
                    searchQuery={paperSearch}
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
    <div className="flex h-full min-h-0 w-full rounded-lg border border-border overflow-hidden bg-background">
      {/* Graph area */}
      <div className="relative h-full min-h-0 min-w-0 flex-1">
        <GraphCanvas
          graph={graph}
          width={canvasW}
          height={canvasH}
          selectedNodeId={resolvedSelectedNodeId}
          onSelectNode={setSelectedNodeId}
          onDeselectNode={() => setSelectedNodeId(null)}
          reviewedArxivIds={reviewedArxivIds}
          searchQuery={paperSearch}
        />
        <div className="pointer-events-auto absolute left-3 top-3 z-10 w-[min(100%,18rem)]">
          <GraphPaperSearch
            value={paperSearch}
            onChange={setPaperSearch}
            matchCount={searchMatchCount}
            total={graph.nodes.length}
          />
        </div>
        {/* Floating legend */}
        <div className="absolute bottom-3 left-3 z-10">
          <GraphLegend />
        </div>
        {/* Hint */}
        <div className="pointer-events-none absolute right-3 top-3 max-w-[11rem] text-right text-[10px] text-muted-foreground/60 select-none">
          Scroll to zoom · Drag to pan · Click a paper
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
