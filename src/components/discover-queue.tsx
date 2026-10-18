"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getDiscoverQueriesSnapshot,
  getRecommendationsSnapshot,
  getReviewsSnapshot,
} from "@/lib/client-data";
import {
  DISCOVER_UPDATED_EVENT,
  KEYS_UPDATED_EVENT,
  REVIEWS_UPDATED_EVENT,
} from "@/lib/storage-events";
import type { DiscoverQuery, Recommendation } from "@/lib/discover-types";
import type { PaperReview } from "@/lib/review-types";
import type { AgentStep } from "@/hooks/use-chat";
import { normalizeArxivId } from "@/lib/arxiv";
import { groupIntoThreads } from "@/lib/discover-threads";
import { hasUsableExaKey } from "@/lib/keys";
import type { BriefRunData } from "./research-brief";

/* ------------------------------------------------------------------ */
/*  Date bucketing                                                     */
/* ------------------------------------------------------------------ */

export type DateBucket = "today" | "yesterday" | "this-week" | "earlier";

function dateBucket(iso: string): DateBucket {
  const then = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  if (then >= startOfToday) return "today";
  if (then >= startOfYesterday) return "yesterday";
  if (then >= startOfWeek) return "this-week";
  return "earlier";
}

/* ------------------------------------------------------------------ */
/*  Acceptance detection                                               */
/* ------------------------------------------------------------------ */

function isAccepted(rec: Recommendation, reviews: PaperReview[]): boolean {
  if (rec.arxivId) {
    const target = normalizeArxivId(rec.arxivId);
    return reviews.some(
      (r) => r.arxivId && normalizeArxivId(r.arxivId) === target,
    );
  }
  return reviews.some((r) => r.sourceUrl === rec.url);
}

/* ------------------------------------------------------------------ */
/*  useDiscoverBriefs — shared data for browse + focus views           */
/* ------------------------------------------------------------------ */

export interface ThreadView {
  root: BriefRunData;
  followups: BriefRunData[];
  bucket: DateBucket;
}

/**
 * Builds the threaded, date-bucketed brief data once and exposes it to both
 * the recent-briefs list (browse) and the focused single-session view. The
 * live query's run is annotated with its streaming steps so whichever view
 * shows it renders live progress.
 */
export function useDiscoverBriefs(
  liveQueryId: string | null,
  liveSteps: AgentStep[],
): { threads: ThreadView[]; hasExaKey: boolean } {
  const [, force] = useState(0);
  useEffect(() => {
    const handler = () => force((n) => n + 1);
    window.addEventListener(DISCOVER_UPDATED_EVENT, handler);
    window.addEventListener(REVIEWS_UPDATED_EVENT, handler);
    return () => {
      window.removeEventListener(DISCOVER_UPDATED_EVENT, handler);
      window.removeEventListener(REVIEWS_UPDATED_EVENT, handler);
    };
  }, []);

  const [hasExaKey, setHasExaKey] = useState(false);
  useEffect(() => {
    const sync = () => setHasExaKey(hasUsableExaKey());
    sync();
    window.addEventListener(KEYS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, sync);
  }, []);

  const queries = getDiscoverQueriesSnapshot();
  const recs = getRecommendationsSnapshot();
  const reviews = getReviewsSnapshot();

  const threads = useMemo(() => {
    const active = new Map<string, Recommendation[]>();
    const dismissed = new Map<string, Recommendation[]>();
    const accepted = new Map<string, number>();
    for (const rec of recs) {
      if (rec.dismissedAt) {
        const list = dismissed.get(rec.queryId) ?? [];
        list.push(rec);
        dismissed.set(rec.queryId, list);
      } else {
        const list = active.get(rec.queryId) ?? [];
        list.push(rec);
        active.set(rec.queryId, list);
      }
      if (isAccepted(rec, reviews)) {
        accepted.set(rec.queryId, (accepted.get(rec.queryId) ?? 0) + 1);
      }
    }
    for (const list of active.values()) list.sort((a, b) => a.rank - b.rank);

    const buildRun = (q: DiscoverQuery): BriefRunData => {
      const live = q.id === liveQueryId;
      return {
        query: live ? { ...q, status: "running" } : q,
        recommendations: active.get(q.id) ?? [],
        dismissed: dismissed.get(q.id) ?? [],
        acceptedCount: accepted.get(q.id) ?? 0,
        liveSteps: live ? liveSteps : undefined,
      };
    };

    return groupIntoThreads(queries).map((t) => ({
      root: buildRun(t.root),
      followups: t.followups.map(buildRun),
      bucket: dateBucket(t.root.createdAt),
    }));
  }, [queries, recs, reviews, liveQueryId, liveSteps]);

  return { threads, hasExaKey };
}
