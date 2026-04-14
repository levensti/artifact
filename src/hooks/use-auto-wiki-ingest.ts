"use client";

/**
 * Silent auto-ingest hook — fires wiki ingest in the background
 * when a paper is first opened. Completely invisible to the user.
 */

import { useEffect, useRef } from "react";
import type { Model } from "@/lib/models";
import { isInferenceProviderType } from "@/lib/models";
import { isModelReady, getApiKey } from "@/lib/keys";
import { checkWikiIngested } from "@/lib/client-data";
import { runWikiIngest } from "@/lib/wiki-ingest";
import { beginWikiIngest, endWikiIngest } from "@/lib/wiki-status";

interface UseAutoWikiIngestOptions {
  reviewId: string;
  paperTitle: string;
  arxivId: string | null;
  paperText: string;
  selectedModel: Model | null;
}

export function useAutoWikiIngest({
  reviewId,
  paperTitle,
  arxivId,
  paperText,
  selectedModel,
}: UseAutoWikiIngestOptions): void {
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!reviewId || !paperText || paperText.length < 100) return;
    if (!selectedModel || !isModelReady(selectedModel)) return;
    // Only fire once per review
    if (firedRef.current === reviewId) return;

    let cancelled = false;

    void (async () => {
      let token: number | null = null;
      try {
        const ingested = await checkWikiIngested(reviewId);
        if (ingested || cancelled) return;

        firedRef.current = reviewId;

        const apiKey = isInferenceProviderType(selectedModel.provider)
          ? ""
          : (getApiKey(selectedModel.provider) ?? "");

        token = beginWikiIngest({
          kind: "paper",
          label: paperTitle || "Paper",
        });

        await runWikiIngest({
          reviewId,
          paperTitle,
          arxivId,
          paperText,
          model: selectedModel,
          apiKey,
        });
      } catch {
        // Silent — ambient operation, failures don't disrupt reading
      } finally {
        if (token !== null) endWikiIngest(token);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reviewId, paperTitle, arxivId, paperText, selectedModel]);
}
