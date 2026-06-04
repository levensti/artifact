"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronRight } from "lucide-react";
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
import { MonoLabel } from "./folio";
import type { BriefRunData } from "./research-brief";

/* ------------------------------------------------------------------ */
/*  Date bucketing                                                     */
/* ------------------------------------------------------------------ */

export type DateBucket = "today" | "yesterday" | "this-week" | "earlier";

const BUCKET_LABELS: Record<DateBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  earlier: "Earlier",
};

const BUCKET_ORDER: DateBucket[] = ["today", "yesterday", "this-week", "earlier"];

function dateBucket(iso: string): DateBucket {
  const then = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  if (then >= startOfToday) return "today";
  if (then >= startOfYesterday) return "yesterday";
  if (then >= startOfWeek) return "this-week";
  return "earlier";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
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

/* ------------------------------------------------------------------ */
/*  Recent briefs list (browse view)                                   */
/* ------------------------------------------------------------------ */

function RecentRow({
  thread,
  onOpen,
}: {
  thread: ThreadView;
  onOpen: (id: string) => void;
}) {
  const { root, followups } = thread;
  const q = root.query;
  const live = !!root.liveSteps;
  const picks = root.recommendations.length;
  const accepted = root.acceptedCount;

  return (
    <button
      type="button"
      onClick={() => onOpen(q.id)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/40 px-3.5 py-2.5 text-left transition-colors hover:border-border hover:bg-card"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-foreground">
          {q.query}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          {live ? (
            <span className="inline-flex items-center gap-1 text-primary">
              <span className="landing-pulse-dot" />
              Researching now
            </span>
          ) : (
            <span>{relativeTime(q.createdAt)}</span>
          )}
          {!live && picks > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span>
                {picks} pick{picks === 1 ? "" : "s"}
                {accepted > 0 ? ` · ${accepted} in library` : ""}
              </span>
            </>
          ) : null}
          {followups.length > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span>
                {followups.length} follow-up{followups.length === 1 ? "" : "s"}
              </span>
            </>
          ) : null}
          {q.status === "errored" ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5 text-destructive/85">
                <AlertCircle className="size-3" strokeWidth={2} />
                errored
              </span>
            </>
          ) : null}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/45" />
    </button>
  );
}

export function RecentBriefsList({
  threads,
  onOpen,
}: {
  threads: ThreadView[];
  onOpen: (id: string) => void;
}) {
  const byBucket = useMemo(() => {
    const map = new Map<DateBucket, ThreadView[]>();
    for (const t of threads) {
      const list = map.get(t.bucket) ?? [];
      list.push(t);
      map.set(t.bucket, list);
    }
    return map;
  }, [threads]);

  if (threads.length === 0) return null;

  return (
    <div className="space-y-6">
      {BUCKET_ORDER.filter((b) => byBucket.has(b)).map((bucket) => (
        <div key={bucket} className="space-y-2.5">
          <MonoLabel>{BUCKET_LABELS[bucket]}</MonoLabel>
          <div className="space-y-2">
            {byBucket.get(bucket)!.map((t) => (
              <RecentRow key={t.root.query.id} thread={t} onOpen={onOpen} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
