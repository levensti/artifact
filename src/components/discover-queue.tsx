"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Folder } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
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
  projectName,
  onOpen,
}: {
  thread: ThreadView;
  projectName: string | null;
  onOpen: (id: string) => void;
}) {
  const { root, followups } = thread;
  const q = root.query;
  const live = !!root.liveSteps;
  const picks = root.recommendations.length;
  const accepted = root.acceptedCount;
  const errored = q.status === "errored";
  const meta = [
    relativeTime(q.createdAt),
    picks > 0 ? `${picks} source${picks === 1 ? "" : "s"}` : "No sources",
    accepted > 0 ? `${accepted} in library` : null,
    followups.length > 0
      ? `${followups.length} follow-up${followups.length === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={() => onOpen(q.id)}
      className="group flex h-full min-h-[148px] w-full flex-col rounded-xl border border-border bg-card px-5 py-5 text-left transition-colors duration-150 hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {projectName ? (
        <p className="mb-2 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Folder className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{projectName}</span>
        </p>
      ) : null}

      {/* Query */}
      <p className="line-clamp-3 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
        {q.query}
      </p>

      {/* Footer: when it ran and what came of it */}
      <div className="mt-auto flex flex-wrap items-center gap-x-1.5 pt-5 text-[13px] text-muted-foreground">
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-primary">
            <span className="landing-pulse-dot" />
            Researching
          </span>
        ) : errored ? (
          <span className="inline-flex items-center gap-1 text-destructive/85">
            <AlertCircle className="size-3.5" strokeWidth={2} />
            Errored
          </span>
        ) : (
          <span>{meta.join(" · ")}</span>
        )}
      </div>
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
  const sorted = useMemo(
    () =>
      [...threads].sort(
        (a, b) =>
          new Date(b.root.query.createdAt).getTime() -
          new Date(a.root.query.createdAt).getTime(),
      ),
    [threads],
  );

  const projects = useProjects();
  if (threads.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((t) => (
        <RecentRow
          key={t.root.query.id}
          thread={t}
          projectName={
            projects.find((p) => p.id === t.root.query.projectId)?.name ?? null
          }
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
