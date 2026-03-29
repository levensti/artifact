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
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphData } from "@/lib/explore";
import { PaperNode } from "@/components/knowledge-graph-node";
import { RelationshipEdge } from "@/components/knowledge-graph-edge";
import { useStaticLayout } from "./graph-layout";
import { buildFlowNodes, buildFlowEdges } from "./graph-flow-builders";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GraphCanvasProps {
  graph: GraphData;
  width: number;
  height: number;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onDeselectNode: () => void;
  reviewedArxivIds?: Set<string>;
  searchQuery: string;
  highlightedNodeIds?: Set<string>;
}

/* ------------------------------------------------------------------ */
/*  Statics                                                            */
/* ------------------------------------------------------------------ */

const nodeTypes = { paper: PaperNode };
const edgeTypes = { relationship: RelationshipEdge };

const FIT_VIEW_OPTIONS = {
  padding: 0.08,
  maxZoom: 1.75,
  minZoom: 0.4,
} as const;

/* ------------------------------------------------------------------ */
/*  Fit-view trigger                                                   */
/* ------------------------------------------------------------------ */

function FitViewWhenGraphChanges({ graphKey }: { graphKey: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    fitView(FIT_VIEW_OPTIONS);
  }, [graphKey, fitView]);
  return null;
}

/* ------------------------------------------------------------------ */
/*  Inner canvas (inside ReactFlowProvider)                            */
/* ------------------------------------------------------------------ */

function GraphCanvasInner({
  graph,
  width,
  height,
  selectedNodeId,
  onSelectNode,
  onDeselectNode,
  reviewedArxivIds,
  searchQuery,
  highlightedNodeIds,
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
        highlightedNodeIds,
      ),
    [graph, positionedNodes, selectedNodeId, hoverNodeId, searchQuery, highlightedNodeIds],
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

/* ------------------------------------------------------------------ */
/*  Outer wrapper (provides ReactFlowProvider + ResizeObserver)        */
/* ------------------------------------------------------------------ */

export default function GraphCanvas(props: GraphCanvasProps) {
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
          highlightedNodeIds={props.highlightedNodeIds}
        />
      </ReactFlowProvider>
    </div>
  );
}
