"use client";

/**
 * Silent auto-ingest hook — fires wiki ingest in the background
 * when a paper is first opened. Completely invisible to the user
 * on success. Failures surface on `onError` so the caller can show
 * a small inline hint (empty-state tooltip, toast) — otherwise a
 * bad API key leaves the user staring at an empty knowledge base
 * with no clue what went wrong.
 */

import { useEffect, useRef } from "react";
import type { Model } from "@/lib/models";
import { isInferenceProviderType } from "@/lib/models";
import { isModelReady, getApiKey } from "@/lib/keys";
import { checkWikiIngested } from "@/lib/client-data";
import { runWikiIngest } from "@/lib/wiki-ingest";
import {
  beginWikiIngest,
  endWikiIngest,
  reportWikiIngestError,
} from "@/lib/wiki-status";

const INGEST_TIMEOUT_MS = 120_000;

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
    // Only fire once per review per session
    if (firedRef.current === reviewId) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS);
    let token: number | null = null;

    void (async () => {
      try {
        const ingested = await checkWikiIngested(reviewId);
        if (ingested || controller.signal.aborted) return;

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
          signal: controller.signal,
        });

        // Only mark the review as "fired" once the ingest succeeded,
        // so a transient failure (bad key, network blip) can retry
        // on the next mount without needing a page refresh.
        firedRef.current = reviewId;
        reportWikiIngestError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Wiki ingest failed";
        reportWikiIngestError(message);
      } finally {
        clearTimeout(timeout);
        if (token !== null) endWikiIngest(token);
      }
    })();

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [reviewId, paperTitle, arxivId, paperText, selectedModel]);
}
