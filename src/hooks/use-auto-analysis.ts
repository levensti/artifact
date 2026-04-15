"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Model } from "@/lib/models";
import { isModelReady, resolveModelCredentials } from "@/lib/keys";
import { loadExplore } from "@/lib/client-data";
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

export function useAnalysis({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  selectedModel,
}: UseAnalysisOptions): UseAnalysisReturn {
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const canRun =
    !!selectedModel &&
    !!paperContext.trim() &&
    isModelReady(selectedModel);

  // Reset when reviewId changes; restore "done" if explore data exists
  useEffect(() => {
    setError(null);
    setProgress(null);
    if (!reviewId.trim()) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    void loadExplore(reviewId).then((d) => {
      if (cancelled) return;
      const hasData =
        d.prerequisites !== null || d.graph !== null;
      setStatus(hasData ? "done" : "idle");
    });
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  const trigger = useCallback((): boolean => {
    if (!selectedModel || !paperContext.trim()) return false;
    if (!isModelReady(selectedModel)) return false;
    const creds = resolveModelCredentials(selectedModel);
    if (!creds) return false;

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
          apiKey: creds.apiKey,
          apiBaseUrl: creds.apiBaseUrl,
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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { status, progress, error, trigger, canRun };
}
