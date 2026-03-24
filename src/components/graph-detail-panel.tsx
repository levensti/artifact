"use client";

import { ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GraphEdge, GraphNode } from "@/lib/explore";

interface GraphDetailPanelProps {
  node: GraphNode | null;
  edge: GraphEdge | null;
  onAddToReadingList: (node: GraphNode) => void;
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
  edge,
  onAddToReadingList,
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

      {edge && (
        <div className="rounded-sm border border-border/80 bg-muted/30 p-2">
          <p className="text-xs font-medium text-foreground capitalize">
            {edge.relationship.replaceAll("-", " ")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{edge.reasoning}</p>
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
        {!node.isCurrent && (
          <Button
            size="sm"
            variant="secondary"
            className="h-8 text-xs"
            onClick={() => onAddToReadingList(node)}
          >
            Add to reading list
            <Plus className="ml-1.5 size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
