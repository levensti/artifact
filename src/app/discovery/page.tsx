"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Compass } from "lucide-react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/dashboard-layout";
import RelatedWorksGraph from "@/components/related-works-graph";
import {
  hydrateClientStore,
  getGlobalGraphData,
  getReviewsSnapshot,
} from "@/lib/client-data";
import { globalGraphToGraphData, EXPLORE_UPDATED_EVENT } from "@/lib/explore";
import {
  normalizeArxivId,
  REVIEWS_UPDATED_EVENT,
  createOrGetReview,
} from "@/lib/reviews";
import {
  KEYS_UPDATED_EVENT,
  getApiKey,
  getSavedSelectedModel,
  isModelReady,
  isBuiltinProviderReady,
} from "@/lib/keys";
import { FALLBACK_MODELS, isInferenceProviderType, type Model } from "@/lib/models";
import type { GraphNode } from "@/lib/explore";
import { runPaperExploreAnalysis } from "@/lib/explore-analysis";

export default function DiscoveryPage() {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [isGeneratingNodeId, setIsGeneratingNodeId] = useState<string | null>(
    null,
  );
  const [generationProgress, setGenerationProgress] = useState<string | null>(
    null,
  );
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(
    new Set(),
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    void hydrateClientStore().then(() => setReady(true));
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(EXPLORE_UPDATED_EVENT, bump);
    window.addEventListener(REVIEWS_UPDATED_EVENT, bump);
    window.addEventListener(KEYS_UPDATED_EVENT, bump);
    return () => {
      window.removeEventListener(EXPLORE_UPDATED_EVENT, bump);
      window.removeEventListener(REVIEWS_UPDATED_EVENT, bump);
      window.removeEventListener(KEYS_UPDATED_EVENT, bump);
    };
  }, []);

  // Consume version to trigger re-render
  void version;

  const reviewedPapers = useMemo(() => {
    void version;
    return ready ? getReviewsSnapshot() : [];
  }, [ready, version]);

  const globalRaw = ready ? getGlobalGraphData() : null;
  const globalGraph = globalGraphToGraphData(globalRaw);

  const reviewedArxivIds = useMemo(() => {
    if (!ready) return new Set<string>();
    return new Set(reviewedPapers.map((r) => normalizeArxivId(r.arxivId)));
  }, [ready, reviewedPapers]);

  const graph = useMemo(() => {
    if (globalGraph && globalGraph.nodes.length > 0) return globalGraph;
    if (reviewedPapers.length === 0) return null;

    return {
      nodes: reviewedPapers.map((r) => ({
        id: r.id,
        title: r.title,
        authors: [],
        abstract: "",
        arxivId: r.arxivId,
        publishedDate: r.createdAt,
        categories: [],
        isCurrent: true,
      })),
      edges: [],
      keywords: [],
      generatedAt: new Date().toISOString(),
      modelUsed: "seeded-from-reviews",
    };
  }, [globalGraph, reviewedPapers]);

  const readCount = useMemo(
    () =>
      graph
        ? graph.nodes.filter((n) =>
            reviewedArxivIds.has(normalizeArxivId(n.arxivId)),
          ).length
        : 0,
    [graph, reviewedArxivIds],
  );
  const unreadCount = graph ? Math.max(0, graph.nodes.length - readCount) : 0;

  const generationModel: Model | null = (() => {
    const saved = getSavedSelectedModel();
    if (saved) return saved;
    return FALLBACK_MODELS.find((m) => isBuiltinProviderReady(m.provider)) ?? null;
  })();

  const canGenerate = !!generationModel;

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 5000);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  const handleGenerateFromNode = useCallback(
    async (node: GraphNode) => {
      if (isGeneratingNodeId) return;

      const model = generationModel;
      if (!model) {
        setGenerationError(
          "Add an API key and select a model in Settings first.",
        );
        router.push("/settings");
        return;
      }
      if (!isModelReady(model)) {
        setGenerationError(
          "Missing API credentials for the selected model (key or base URL).",
        );
        router.push("/settings");
        return;
      }

      setGenerationError(null);
      setIsGeneratingNodeId(node.id);
      setGenerationProgress("Starting analysis…");

      try {
        const beforeIds = new Set(
          (graph?.nodes ?? []).map((n) => normalizeArxivId(n.arxivId)),
        );
        const review = await createOrGetReview(node.arxivId, node.title);
        const paperContext = [node.title, node.abstract]
          .filter((x) => typeof x === "string" && x.trim().length > 0)
          .join("\n\n");

        await runPaperExploreAnalysis({
          reviewId: review.id,
          arxivId: node.arxivId,
          paperTitle: node.title,
          paperContext,
          model,
          apiKey: isInferenceProviderType(model.provider) ? "" : (getApiKey(model.provider) ?? ""),
          onProgress: setGenerationProgress,
        });
        const after = getGlobalGraphData();
        const newlyAdded = (after?.nodes ?? []).filter(
          (n) => !beforeIds.has(normalizeArxivId(n.arxivId)),
        );
        if (newlyAdded.length > 0) {
          setHighlightedNodeIds(new Set(newlyAdded.map((n) => n.id)));
          setToastMessage(
            `Found ${newlyAdded.length} new work${newlyAdded.length === 1 ? "" : "s"}.`,
          );
          setTimeout(() => setHighlightedNodeIds(new Set()), 8000);
        } else {
          setToastMessage("No new works discovered this run.");
        }
        setGenerationProgress("Done. Discover graph updated.");
      } catch (err) {
        setGenerationError(
          err instanceof Error
            ? err.message
            : "Failed to generate related works.",
        );
      } finally {
        setTimeout(() => {
          setIsGeneratingNodeId(null);
          setGenerationProgress(null);
        }, 900);
      }
    },
    [generationModel, isGeneratingNodeId, router, graph],
  );

  if (!ready) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Loading…
        </div>
      </DashboardLayout>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full px-6 bg-background">
          <div className="max-w-md text-center space-y-8">
            <div className="mx-auto size-16 rounded-xl border border-border bg-card flex items-center justify-center">
              <Compass size={28} className="text-primary" strokeWidth={1.5} />
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  Discover
                </h1>
                <p className="text-xs font-medium tracking-wide text-muted-foreground">
                  Map your research frontier
                </p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
                You have not reviewed any papers yet. Start your first review,
                then grow this space into a living map of ideas, methods, and
                connections as you explore with the assistant.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-muted-foreground/70 text-xs">
              <span>From first paper to research map</span>
              <span className="size-0.5 rounded-full bg-muted-foreground/35" />
              <span>Assistant-guided discovery</span>
              <span className="size-0.5 rounded-full bg-muted-foreground/35" />
              <span>Built as you learn</span>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <Compass className="size-4 text-primary" strokeWidth={2} />
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            Discover
          </h1>
          <span className="ml-1 rounded-full bg-muted px-2 py-px text-[10px] tabular-nums text-muted-foreground font-medium">
            {readCount} read
          </span>
          <span className="rounded-full bg-muted px-2 py-px text-[10px] tabular-nums text-muted-foreground font-medium">
            {unreadCount} unread
          </span>
        </header>
        <div className="flex-1 min-h-0 p-3">
          {toastMessage && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-900">
              <CheckCircle2 className="size-3.5 shrink-0" />
              <span>{toastMessage}</span>
              <button
                type="button"
                className="ml-auto text-emerald-900/70 hover:text-emerald-900"
                onClick={() => setToastMessage(null)}
                aria-label="Dismiss notification"
              >
                Dismiss
              </button>
            </div>
          )}
          <RelatedWorksGraph
            graph={graph}
            workspace
            reviewedArxivIds={reviewedArxivIds}
            onGenerateRelated={handleGenerateFromNode}
            isGeneratingNodeId={isGeneratingNodeId}
            generationProgress={generationProgress}
            generationError={generationError}
            canGenerate={canGenerate}
            onOpenSettings={() => router.push("/settings")}
            highlightedNodeIds={highlightedNodeIds}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
