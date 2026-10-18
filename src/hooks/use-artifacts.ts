"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import type { ReviewArtifact } from "@/lib/artifacts";

/**
 * A review's saved artifacts. The chat route saves new ones when a turn
 * ends, so the chat calls `refreshArtifacts` after each turn and every
 * mounted `useArtifacts` for that review refetches.
 */

const listeners = new Map<string, Set<() => void>>();

export function refreshArtifacts(reviewId: string): void {
  listeners.get(reviewId)?.forEach((fn) => fn());
}

export function useArtifacts(reviewId: string) {
  const [artifacts, setArtifacts] = useState<ReviewArtifact[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ artifacts: ReviewArtifact[] }>(
        `/api/reviews/${reviewId}/artifacts`,
      );
      setArtifacts(res.artifacts);
    } catch (e) {
      console.error("Failed to load artifacts:", e);
    } finally {
      setLoaded(true);
    }
  }, [reviewId]);

  useEffect(() => {
    void load();
    const set = listeners.get(reviewId) ?? new Set();
    const fn = () => void load();
    set.add(fn);
    listeners.set(reviewId, set);
    return () => {
      set.delete(fn);
    };
  }, [reviewId, load]);

  return { artifacts, loaded };
}
