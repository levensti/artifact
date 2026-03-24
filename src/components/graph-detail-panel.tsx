"use client";

import { ExternalLink, MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GraphEdge, GraphNode } from "@/lib/explore";

interface GraphDetailPanelProps {
  node: GraphNode | null;
  /** All edges incident to `node` (ordered by importance if available) */
  incidentEdges: GraphEdge[];
  onStartReview: (node: GraphNode) => void;
  onDiscussInChat?: (node: GraphNode) => void;
}

function formatDate(iso: string) {
  if (!iso) return "Unknown date";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "Unknown date";
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function GraphDetailPanel({
  node,
  incidentEdges,
  onStartReview,
  onDiscussInChat,
}: GraphDetailPanelProps) {
  if (!node) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        Select a node to inspect details and relationship reasoning.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold leading-snug text-foreground">{node.title}</h4>
        <p className="text-xs text-muted-foreground">
          {node.authors.slice(0, 4).join(", ")}
          {node.authors.length > 4 ? " et al." : ""}
        </p>
        <p className="text-xs text-muted-foreground">{formatDate(node.publishedDate)}</p>
      </div>

      {incidentEdges.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {incidentEdges.length === 1 ? "Relationship" : "Relationships"}
          </p>
          {incidentEdges.map((e, i) => (
            <div
              key={`${e.source}-${e.target}-${e.relationship}-${i}`}
              className="rounded-sm border border-border/80 bg-muted/30 p-2"
            >
              <p className="text-xs font-medium text-foreground capitalize">
                {e.relationship.replaceAll("-", " ")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{e.reasoning}</p>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs leading-relaxed text-foreground/90">{node.abstract}</p>

      <div className="flex items-center gap-2">
        <a
          href={`https://arxiv.org/abs/${node.arxivId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex"
        >
          <Button size="sm" variant="outline" className="h-8 text-xs">
            Open on arXiv
            <ExternalLink className="ml-1.5 size-3.5" />
          </Button>
        </a>
        {!node.isCurrent && node.arxivId && (
          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={() => onStartReview(node)}
          >
            Open review
            <Plus className="ml-1.5 size-3.5" />
          </Button>
        )}
        {onDiscussInChat && !node.isCurrent && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => onDiscussInChat(node)}
          >
            <MessageSquare className="mr-1.5 size-3.5" />
            Discuss
          </Button>
        )}
      </div>
    </div>
  );
}
