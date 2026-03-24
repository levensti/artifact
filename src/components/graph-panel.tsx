"use client";

import { Network } from "lucide-react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useExploreData } from "@/hooks/use-explore-data";
import RelatedWorksGraph from "@/components/related-works-graph";

interface GraphPanelProps {
  reviewId: string;
  onDiscussInChat?: (title: string) => void;
}

export default function GraphPanel({ reviewId, onDiscussInChat }: GraphPanelProps) {
  const { graph: graphData } = useExploreData(reviewId);

  if (!graphData) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center gap-3 px-4">
        <Network className="size-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground leading-relaxed max-w-[260px]">
          The related works graph will appear here once the paper is analyzed.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {graphData.nodes.length} papers · {graphData.edges.length} connections
        </p>
        <Link
          href={`/discover?reviewId=${encodeURIComponent(reviewId)}`}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors shrink-0"
        >
          Discovery
          <ExternalLink className="size-3 opacity-70" />
        </Link>
      </div>
      <RelatedWorksGraph graph={graphData} onDiscussInChat={onDiscussInChat} />
    </div>
  );
}
