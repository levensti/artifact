"use client";

import { useMemo, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import type { GraphData, GraphNode } from "@/lib/explore";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import GraphDetailPanel from "@/components/graph-detail-panel";
import { createOrGetReview } from "@/lib/reviews";
import { useRouter } from "next/navigation";

import { paperMatchesQuery } from "./graph-layout";
import { incidentEdges } from "./graph-flow-builders";
import GraphCanvas from "./graph-canvas";
import { GraphPaperSearch, GraphLegend } from "./graph-controls";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface RelatedWorksGraphProps {
  graph: GraphData;
  workspace?: boolean;
  onDiscussInChat?: (title: string) => void;
  reviewedArxivIds?: Set<string>;
  onGenerateRelated?: (node: GraphNode) => void;
  isGeneratingNodeId?: string | null;
  generationProgress?: string | null;
  generationError?: string | null;
  canGenerate?: boolean;
  onOpenSettings?: () => void;
  highlightedNodeIds?: Set<string>;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function RelatedWorksGraph({
  graph,
  workspace = false,
  onDiscussInChat,
  reviewedArxivIds,
  onGenerateRelated,
  isGeneratingNodeId = null,
  generationProgress = null,
  generationError = null,
  canGenerate = true,
  onOpenSettings,
  highlightedNodeIds,
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
    void createOrGetReview(node.arxivId, node.title).then((review) => {
      router.push(`/review/${review.id}`);
    });
  };

  const canvasW = workspace ? 560 : 520;
  const canvasH = workspace ? 380 : 320;

  /* ---- Shared detail panel props ---- */
  const detailPanelProps = {
    node: selectedNode,
    incidentEdges: selectedIncident,
    onStartReview,
    onGenerateRelated,
    isGenerating: isGeneratingNodeId === selectedNode?.id,
    generationProgress:
      isGeneratingNodeId === selectedNode?.id ? generationProgress : null,
    generationError:
      isGeneratingNodeId === selectedNode?.id ? generationError : null,
    canGenerate,
    onOpenSettings,
  };

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
            highlightedNodeIds={highlightedNodeIds}
          />
        </div>

        {resolvedSelectedNodeId && (
          <GraphDetailPanel
            {...detailPanelProps}
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
                    highlightedNodeIds={highlightedNodeIds}
                  />
                </div>
                <div className="mt-2 shrink-0">
                  <GraphLegend />
                </div>
              </div>
              {resolvedSelectedNodeId && (
                <div className="w-[340px] border-l border-border bg-card/50 p-4 overflow-y-auto">
                  <GraphDetailPanel {...detailPanelProps} />
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
          highlightedNodeIds={highlightedNodeIds}
        />
        <div className="pointer-events-auto absolute left-3 top-3 z-10 w-[min(100%,18rem)]">
          <GraphPaperSearch
            value={paperSearch}
            onChange={setPaperSearch}
            matchCount={searchMatchCount}
            total={graph.nodes.length}
          />
        </div>
        <div className="absolute bottom-3 left-3 z-10">
          <GraphLegend />
        </div>
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
              {...detailPanelProps}
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
