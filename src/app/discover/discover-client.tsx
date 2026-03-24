"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Compass, Brain, ArrowRight, ExternalLink, Share2 } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import { Button } from "@/components/ui/button";
import RelatedWorksGraph from "@/components/related-works-graph";
import { getReviews, REVIEWS_UPDATED_EVENT, type PaperReview } from "@/lib/reviews";
import {
  EXPLORE_UPDATED_EVENT,
  clearGlobalKnowledgeGraph,
  getGraphData,
  globalGraphToGraphData,
  type GraphData,
} from "@/lib/explore";
import {
  DEEP_DIVES_UPDATED_EVENT,
  getDeepDives,
  type DeepDiveSession,
} from "@/lib/deep-dives";

function subscribeDeepDives(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DEEP_DIVES_UPDATED_EVENT, onStoreChange);
  return () => window.removeEventListener(DEEP_DIVES_UPDATED_EVENT, onStoreChange);
}

function subscribeReviewsAndExplore(onStoreChange: () => void) {
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

function deepDiveSnapshot() {
  return JSON.stringify(getDeepDives());
}

function globalGraphSnapshot() {
  return JSON.stringify(globalGraphToGraphData());
}

export default function DiscoverClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tabFromUrl: "graphs" | "knowledge" | "library" =
    tabParam === "library" ? "library" : tabParam === "knowledge" ? "knowledge" : "graphs";
  const [tab, setTab] = useState<"graphs" | "knowledge" | "library">(tabFromUrl);

  useEffect(() => {
    setTab(tabFromUrl);
  }, [tabFromUrl]);
  const reviewIdFromUrl = searchParams.get("reviewId");
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(reviewIdFromUrl);

  useEffect(() => {
    setSelectedReviewId(reviewIdFromUrl);
  }, [reviewIdFromUrl]);

  const reviewsJson = useSyncExternalStore(
    subscribeReviewsAndExplore,
    reviewsSnapshot,
    () => "[]",
  );
  const divesJson = useSyncExternalStore(
    subscribeDeepDives,
    deepDiveSnapshot,
    () => "[]",
  );
  const mergedGraphJson = useSyncExternalStore(
    subscribeReviewsAndExplore,
    globalGraphSnapshot,
    () => "null",
  );

  const reviews = useMemo(() => JSON.parse(reviewsJson) as PaperReview[], [reviewsJson]);
  const deepDives = useMemo(() => JSON.parse(divesJson) as DeepDiveSession[], [divesJson]);
  const mergedGraph = useMemo(() => {
    try {
      return JSON.parse(mergedGraphJson) as GraphData | null;
    } catch {
      return null;
    }
  }, [mergedGraphJson]);

  const graphs = useMemo(() => {
    return reviews
      .map((review) => ({
        review,
        graph: getGraphData(review.id),
      }))
      .filter((item): item is { review: PaperReview; graph: GraphData } => item.graph != null);
  }, [reviews]);

  const selectedGraph = useMemo(() => {
    if (selectedReviewId != null) {
      return graphs.find((item) => item.review.id === selectedReviewId) ?? null;
    }
    return graphs[0] ?? null;
  }, [graphs, selectedReviewId]);

  const pinnedReviewWithoutMap =
    selectedReviewId != null &&
    selectedGraph == null &&
    reviews.some((r) => r.id === selectedReviewId);

  return (
    <DashboardLayout>
      <div className="h-full overflow-y-auto bg-background px-6 py-5">
        <div className="max-w-[1200px] mx-auto space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Discovery Workspace
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Per-paper maps, a merged literature graph across sessions, and saved prerequisite study guides.
              </p>
            </div>
            <div className="inline-flex flex-wrap gap-1 rounded-md border border-border bg-card p-1">
              <button
                type="button"
                className={`px-3 py-1.5 text-sm rounded ${tab === "graphs" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                onClick={() => {
                  setTab("graphs");
                  router.replace("/discover", { scroll: false });
                }}
              >
                <Compass className="size-4 inline mr-1.5" />
                Paper maps
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 text-sm rounded ${tab === "knowledge" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                onClick={() => {
                  setTab("knowledge");
                  router.replace("/discover?tab=knowledge", { scroll: false });
                }}
              >
                <Share2 className="size-4 inline mr-1.5" />
                Knowledge map
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 text-sm rounded ${tab === "library" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                onClick={() => {
                  setTab("library");
                  router.replace("/discover?tab=library", { scroll: false });
                }}
              >
                <Brain className="size-4 inline mr-1.5" />
                Prerequisite library
              </button>
            </div>
          </div>

          {tab === "graphs" && (
            <div className="grid grid-cols-[290px_1fr] gap-4 min-h-[620px]">
              <div className="rounded-lg border border-border bg-card p-3 overflow-y-auto max-h-[760px]">
                <p className="text-xs font-medium text-muted-foreground mb-2">Paper maps</p>
                <div className="space-y-1.5">
                  {graphs.map((item) => (
                    <button
                      key={item.review.id}
                      type="button"
                      onClick={() => {
                        setSelectedReviewId(item.review.id);
                        router.replace(`/discover?reviewId=${encodeURIComponent(item.review.id)}`, {
                          scroll: false,
                        });
                      }}
                      className={`w-full text-left px-2.5 py-2 rounded-md border transition-colors ${
                        selectedGraph?.review.id === item.review.id
                          ? "bg-muted border-border"
                          : "bg-background border-transparent hover:bg-muted/30"
                      }`}
                    >
                      <p className="text-sm font-medium text-foreground truncate">{item.review.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {Math.max(0, item.graph.nodes.length - 1)} related papers
                      </p>
                    </button>
                  ))}
                  {graphs.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No graph data yet. Open a paper review, run Explore, then return here.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4 min-h-[620px]">
                {selectedGraph ? (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{selectedGraph.review.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Star map from one review session. Edge labels show how each paper connects.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/review/${selectedGraph.review.id}`)}
                      >
                        Open paper review
                        <ArrowRight className="ml-1.5 size-3.5" />
                      </Button>
                    </div>
                    <RelatedWorksGraph graph={selectedGraph.graph} workspace />
                  </>
                ) : pinnedReviewWithoutMap ? (
                  <div className="h-full grid place-items-center px-4">
                    <div className="text-center space-y-2 max-w-md">
                      <p className="text-sm text-foreground">
                        This review is not in Paper maps yet.
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Run <span className="font-medium text-foreground/85">Analyze paper</span> in Explore
                        for this paper, then return here.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => router.push(`/review/${selectedReviewId}`)}
                      >
                        Open paper review
                        <ArrowRight className="ml-1.5 size-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="h-full grid place-items-center text-sm text-muted-foreground">
                    No maps available yet.
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "knowledge" && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-3 min-h-[620px]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Knowledge map</p>
                  <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                    Merges every Explore run across your reviews. Papers link when a relationship was inferred;
                    components can stay disconnected until you explore more papers.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Clear the merged knowledge map? Per-paper Explore caches stay intact.",
                      )
                    ) {
                      clearGlobalKnowledgeGraph();
                    }
                  }}
                >
                  Clear merged map
                </Button>
              </div>
              {mergedGraph && mergedGraph.nodes.length > 0 ? (
                <RelatedWorksGraph graph={mergedGraph} workspace />
              ) : (
                <p className="text-sm text-muted-foreground py-12 text-center">
                  No merged graph yet. Run Explore on at least one paper to add nodes and edges.
                </p>
              )}
            </div>
          )}

          {tab === "library" && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="space-y-3">
                {deepDives.map((session) => (
                  <div key={session.id} className="rounded-md border border-border bg-background p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{session.topic}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{session.paperTitle}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <a href={`https://arxiv.org/abs/${session.arxivId}`} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="ghost">
                            arXiv
                            <ExternalLink className="ml-1.5 size-3.5" />
                          </Button>
                        </a>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => router.push(`/review/${session.reviewId}`)}
                        >
                          Open review
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm text-foreground/90 mt-2 leading-relaxed">{session.explanation}</p>
                  </div>
                ))}
                {deepDives.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No study guides yet. In Explore, open a prerequisite &quot;Generate study guide&quot; to save one here.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
