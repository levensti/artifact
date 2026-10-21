"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import type { ReviewArtifact } from "@/lib/artifacts";

/**
 * A review's saved artifacts. The artifact tools save while a turn runs, so
 * the chat calls `refreshArtifacts` when an artifact tool returns and when a
 * turn ends, and every mounted `useArtifacts` for that review refetches.
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

/* ------------------------------------------------------------------ */
/*  Versions and actions                                               */
/* ------------------------------------------------------------------ */

const base = (reviewId: string, artifactId: string) =>
  `/api/reviews/${reviewId}/artifacts/${artifactId}`;

/** Versions never change once written, so their source caches forever. */
const versionCache = new Map<string, Promise<string>>();

/** One version's source (fetched once). */
export function fetchArtifactVersion(
  reviewId: string,
  artifactId: string,
  version: number,
): Promise<string> {
  const key = `${artifactId}:${version}`;
  let hit = versionCache.get(key);
  if (!hit) {
    hit = apiFetch<{ version: { html: string } }>(
      `${base(reviewId, artifactId)}?version=${version}`,
    ).then((r) => r.version.html);
    hit.catch(() => versionCache.delete(key));
    versionCache.set(key, hit);
  }
  return hit;
}

/** Append a copy of `version` as the new current version. */
export async function restoreArtifact(
  reviewId: string,
  artifactId: string,
  version: number,
): Promise<void> {
  await apiFetch(base(reviewId, artifactId), {
    method: "POST",
    body: { action: "restore", version },
  });
  refreshArtifacts(reviewId);
}

/** Move the latest edit (`version`) into its own artifact; the original goes
 *  back to the version before it. Returns the new artifact's id. */
export async function splitArtifact(
  reviewId: string,
  artifactId: string,
  version: number,
): Promise<string> {
  const res = await apiFetch<{ created: { id: string } }>(base(reviewId, artifactId), {
    method: "POST",
    body: { action: "split", version },
  });
  refreshArtifacts(reviewId);
  return res.created.id;
}

/** Reader state saved this session, newer than the fetched list until the
 *  next refresh, so reopening an artifact restores what the reader just did. */
const localState = new Map<string, unknown>();

export function latestArtifactState(artifactId: string, fetched: unknown): unknown {
  return localState.has(artifactId) ? localState.get(artifactId) : fetched;
}

/** Save what the reader did inside the page (best-effort). */
export async function saveArtifactState(
  reviewId: string,
  artifactId: string,
  state: unknown,
): Promise<void> {
  localState.set(artifactId, state);
  try {
    await apiFetch(base(reviewId, artifactId), { method: "PUT", body: { state } });
  } catch (e) {
    console.error("Failed to save artifact state:", e);
  }
}
