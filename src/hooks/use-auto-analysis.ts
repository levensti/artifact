"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Model } from "@/lib/models";
import { getApiKey } from "@/lib/keys";
import { getPrerequisites, getGraphData } from "@/lib/explore";
import { runPaperExploreAnalysis } from "@/lib/explore-analysis";

export type AnalysisStatus = "idle" | "running" | "done" | "error";

interface UseAnalysisOptions {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  selectedModel: Model | null;
}

interface UseAnalysisReturn {
  status: AnalysisStatus;
  progress: string | null;
  error: string | null;
  /** Manually trigger analysis. Returns false if prerequisites not met. */
  trigger: () => boolean;
  /** Whether the user can run analysis right now (model + key + paper text). */
  canRun: boolean;
}

function hasAnalysisData(reviewId: string): boolean {
  return getPrerequisites(reviewId) !== null || getGraphData(reviewId) !== null;
}

export function useAnalysis({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  selectedModel,
}: UseAnalysisOptions): UseAnalysisReturn {
  const [status, setStatus] = useState<AnalysisStatus>(() =>
    hasAnalysisData(reviewId) ? "done" : "idle",
  );
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const canRun =
    !!selectedModel &&
    !!paperContext.trim() &&
    !!getApiKey(selectedModel.provider);

  // Reset when reviewId changes
  useEffect(() => {
    setError(null);
    setStatus(hasAnalysisData(reviewId) ? "done" : "idle");
    setProgress(null);
  }, [reviewId]);

  const trigger = useCallback((): boolean => {
    if (!selectedModel || !paperContext.trim()) return false;
    const apiKey = getApiKey(selectedModel.provider);
    if (!apiKey) return false;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("running");
    setError(null);
    setProgress("Starting analysis…");

    void (async () => {
      try {
        await runPaperExploreAnalysis({
          reviewId,
          arxivId,
          paperTitle,
          paperContext,
          model: selectedModel,
          apiKey,
          signal: controller.signal,
          onProgress: setProgress,
        });
        setStatus("done");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Analysis failed.");
      } finally {
        setProgress(null);
      }
    })();

    return true;
  }, [reviewId, arxivId, paperTitle, paperContext, selectedModel]);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { status, progress, error, trigger, canRun };
}
