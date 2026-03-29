"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Network, ArrowRight } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import { Button } from "@/components/ui/button";
import RelatedWorksGraph from "@/components/related-works-graph";
import {
  getReviews,
  normalizeArxivId,
  REVIEWS_UPDATED_EVENT,
  type PaperReview,
} from "@/lib/reviews";
import { EXPLORE_UPDATED_EVENT, globalGraphToGraphData, type GraphData } from "@/lib/explore";
import { getGlobalGraphData } from "@/lib/client-data";

/* ------------------------------------------------------------------ */
/*  Store subscriptions                                                */
/* ------------------------------------------------------------------ */

function subscribeStore(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
  window.addEventListener(EXPLORE_UPDATED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
    window.removeEventListener(EXPLORE_UPDATED_EVENT, onStoreChange);
  };
}

function reviewsSnapshot() {
  return JSON.stringify(getReviews());
}

function globalGraphSnapshot() {
  return JSON.stringify(globalGraphToGraphData(getGlobalGraphData()));
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function DiscoverClient() {
  const router = useRouter();

  const reviewsJson = useSyncExternalStore(subscribeStore, reviewsSnapshot, () => "[]");
  const mergedGraphJson = useSyncExternalStore(subscribeStore, globalGraphSnapshot, () => "null");

  const reviews = useMemo(() => JSON.parse(reviewsJson) as PaperReview[], [reviewsJson]);
  const mergedGraph = useMemo(() => {
    try {
      return JSON.parse(mergedGraphJson) as GraphData | null;
    } catch {
      return null;
    }
  }, [mergedGraphJson]);

  const reviewedArxivIds = useMemo(
    () => new Set(reviews.map((r) => normalizeArxivId(r.arxivId))),
    [reviews],
  );

  const hasData = mergedGraph != null && mergedGraph.nodes.length > 0;
  const paperCount = mergedGraph?.nodes.length ?? 0;
  const edgeCount = mergedGraph?.edges.length ?? 0;

  return (
    <DashboardLayout>
      <div className="h-full flex flex-col overflow-hidden bg-background">
        {/* Header */}
        <div className="shrink-0 px-5 pt-4 pb-3 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Knowledge Graph
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasData
                ? `${paperCount} paper${paperCount !== 1 ? "s" : ""} · ${edgeCount} connection${edgeCount !== 1 ? "s" : ""}`
                : "Your research landscape grows as you explore papers"}
            </p>
          </div>
        </div>

        {/* Graph area */}
        <div className="flex-1 min-h-0 px-5 pb-4">
          {hasData ? (
            <RelatedWorksGraph
              graph={mergedGraph}
              workspace
              reviewedArxivIds={reviewedArxivIds}
            />
          ) : (
            <EmptyState onGoToReview={() => {
              const first = reviews[0];
              if (first) {
                router.push(`/review/${first.id}`);
              } else {
                router.push("/");
              }
            }} />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyState({ onGoToReview }: { onGoToReview: () => void }) {
  return (
    <div className="h-full rounded-lg border border-border bg-[#f5f1ee] flex items-center justify-center">
      <div className="text-center max-w-sm px-6 space-y-4">
        {/* Decorative mini-graph */}
        <div className="flex justify-center">
          <svg width="120" height="72" viewBox="0 0 120 72" className="text-muted-foreground/25">
            <circle cx="60" cy="20" r="8" fill="currentColor" opacity="0.5" />
            <circle cx="30" cy="52" r="6" fill="currentColor" opacity="0.35" />
            <circle cx="90" cy="52" r="6" fill="currentColor" opacity="0.35" />
            <circle cx="16" cy="28" r="4" fill="currentColor" opacity="0.2" />
            <circle cx="104" cy="28" r="4" fill="currentColor" opacity="0.2" />
            <line x1="60" y1="28" x2="30" y2="46" stroke="currentColor" strokeWidth="1" opacity="0.25" />
            <line x1="60" y1="28" x2="90" y2="46" stroke="currentColor" strokeWidth="1" opacity="0.25" />
            <line x1="60" y1="12" x2="16" y2="24" stroke="currentColor" strokeWidth="1" opacity="0.15" />
            <line x1="60" y1="12" x2="104" y2="24" stroke="currentColor" strokeWidth="1" opacity="0.15" />
            <line x1="30" y1="52" x2="90" y2="52" stroke="currentColor" strokeWidth="1" opacity="0.15" strokeDasharray="3 4" />
          </svg>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-center gap-2">
            <Network className="size-4 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground/80">
              No papers mapped yet
            </p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Open a paper review and run{" "}
            <span className="font-medium text-foreground/70">Analyze paper</span>{" "}
            to discover related works. Each analysis adds to this graph.
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="text-xs"
          onClick={onGoToReview}
        >
          Go to a review
          <ArrowRight className="ml-1.5 size-3.5" />
        </Button>
      </div>
    </div>
  );
}
