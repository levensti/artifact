"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
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
import MarkdownMessage from "./markdown-message";
import RecommendationCard from "./recommendation-card";
import DiscoverSteps from "./discover-picks";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import { hasUsableExaKey } from "@/lib/keys";
import { MonoLabel } from "./folio";

/* ------------------------------------------------------------------ */
/*  Time formatting                                                    */
/* ------------------------------------------------------------------ */

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

function absoluteDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

type DateBucket = "today" | "yesterday" | "this-week" | "earlier";

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

/** True when the user has a Review whose source matches this rec — i.e.,
 *  the rec turned into something they're actually reading. Used for the
 *  collapsed "M in library" summary. */
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
/*  Query section                                                      */
/* ------------------------------------------------------------------ */

/** Detects the agent-trajectory note we generate when the only failure
 *  was a missing Exa key. Used to surface a persistent "Add Exa key"
 *  card on finalized queries that came back picks-empty for that reason. */
function notesIndicateExaKeyMissing(notes: string | null | undefined): boolean {
  return !!notes && /exa key required/i.test(notes);
}

/** True when the agent finalized without running any tools — e.g. it
 *  asked a clarifying question or emitted a refusal. The tool-activity
 *  summary heading is our marker; without it, the agent only narrated. */
function agentNarratedOnly(
  notes: string | null | undefined,
  recommendationCount: number,
): boolean {
  if (recommendationCount > 0) return false;
  if (!notes || !notes.trim()) return false;
  return !/\*\*Tool activity:\*\*/i.test(notes);
}

function QuerySection({
  query,
  recommendations,
  dismissedCount,
  acceptedCount,
  defaultCollapsed,
  liveSteps,
  hasExaKey,
}: {
  query: DiscoverQuery;
  recommendations: Recommendation[];
  dismissedCount: number;
  acceptedCount: number;
  defaultCollapsed: boolean;
  /** When set, this section is the in-flight query — render the agent
   *  activity stream inline instead of the empty/loading state. */
  liveSteps?: AgentStep[];
  /** Whether the user currently has an Exa key configured. Drives the
   *  persistent "Enable web search" affordance on finalized empty queries. */
  hasExaKey: boolean;
}) {
  const isLive = !!liveSteps;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const noPicks = recommendations.length === 0 && query.status !== "running";
  const showExaCard =
    !isLive && noPicks && !hasExaKey && notesIndicateExaKeyMissing(query.notes);
  // Default-expand notes only when there are no picks (it's the only
  // diagnostic surface) AND the section itself is expanded.
  const [showNotes, setShowNotes] = useState(noPicks);

  const remainingCount =
    recommendations.length - acceptedCount;
  const totalPicks = recommendations.length + dismissedCount;

  return (
    <section className="space-y-2">
      <header className="border-b border-border/40 pb-1.5">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex w-full items-start gap-2 text-left transition-colors hover:text-foreground"
        >
          <span className="mt-1 shrink-0 text-muted-foreground/60">
            {collapsed ? (
              <ChevronRight className="size-3.5" strokeWidth={2} />
            ) : (
              <ChevronDown className="size-3.5" strokeWidth={2} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className="text-[14px] font-semibold leading-snug text-foreground"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              {query.query}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span title={new Date(query.createdAt).toLocaleString()}>
                {absoluteDate(query.createdAt)}
              </span>
              <span aria-hidden>·</span>
              <span>{relativeTime(query.createdAt)}</span>
              <span aria-hidden>·</span>
              <span>
                {totalPicks} pick{totalPicks === 1 ? "" : "s"}
                {acceptedCount > 0 ? ` · ${acceptedCount} in library` : ""}
                {dismissedCount > 0 ? ` · ${dismissedCount} dismissed` : ""}
                {!collapsed && remainingCount > 0 && (acceptedCount > 0 || dismissedCount > 0)
                  ? ` · ${remainingCount} pending`
                  : ""}
              </span>
              {query.status === "errored" ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-0.5 text-destructive/85">
                    <AlertCircle className="size-3" strokeWidth={2} />
                    errored
                  </span>
                </>
              ) : null}
              {!collapsed && query.notes ? (
                <>
                  <span aria-hidden>·</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowNotes((v) => !v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowNotes((v) => !v);
                      }
                    }}
                    className="inline-flex cursor-pointer items-center gap-0.5 text-muted-foreground/80 transition-colors hover:text-foreground"
                  >
                    {showNotes ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    agent trajectory
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </button>
      </header>
      {collapsed ? null : (
        <>
          {showNotes ? (
            query.notes ? (
              <div className="rounded-md border border-border/40 bg-muted/15 px-3 py-2 text-[12px]">
                <MarkdownMessage content={query.notes} />
              </div>
            ) : noPicks ? (
              <div className="rounded-md border border-border/40 bg-muted/15 px-3 py-2 text-[12px] italic text-muted-foreground/80">
                The agent ended its turn without emitting any text. This usually
                means it stopped without calling a tool — likely a model or
                prompt mismatch. Try resubmitting, switching models, or
                rephrasing the query.
              </div>
            ) : null
          ) : null}
          {recommendations.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {recommendations.map((rec) => (
                <RecommendationCard key={rec.id} rec={rec} />
              ))}
            </div>
          ) : isLive ? (
            <div
              className="rounded-md border border-primary/20 bg-primary/[0.03] px-3 py-2.5 text-[13px] leading-relaxed text-foreground"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              <DiscoverSteps steps={liveSteps!} />
            </div>
          ) : showExaCard ? (
            // Empty-picks because web_search was the only signal and it
            // demanded a key. Persistent retry surface — when the user
            // adds a key the card auto-resumes the same query text.
            <ExaKeyPromptCard queryText={query.query} />
          ) : agentNarratedOnly(query.notes, recommendations.length) &&
            query.status !== "errored" &&
            dismissedCount === 0 ? null : (
            <p className="text-[12px] italic text-muted-foreground/70">
              {query.status === "errored"
                ? "The agent errored before returning picks. Try resubmitting the query."
                : dismissedCount > 0
                  ? "All recommendations dismissed."
                  : "No picks — the agent didn't surface anything for this query. Try a more specific phrasing or a different angle."}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Pending decision section                                           */
/* ------------------------------------------------------------------ */

/** Synthetic "live" section rendered above the queue when the discover
 *  hook deferred a submit on a missing Exa key. Shells like a real
 *  in-flight QuerySection so the prompt reads as the first step of an
 *  active discovery rather than a pre-flight modal floating above. */
function PendingDecisionSection({ text }: { text: string }) {
  return (
    <section className="space-y-2">
      <header className="border-b border-border/40 pb-1.5">
        <div className="flex items-start gap-2">
          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/60 animate-pulse" />
          <div className="min-w-0 flex-1">
            <h2
              className="text-[14px] font-semibold leading-snug text-foreground"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              {text}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>just now</span>
              <span aria-hidden>·</span>
              <span>awaiting your choice on web search</span>
            </div>
          </div>
        </div>
      </header>
      <ExaKeyPromptCard queryText={text} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Queue                                                              */
/* ------------------------------------------------------------------ */

export default function DiscoverQueue({
  liveQueryId,
  liveSteps,
  pendingDecision,
}: {
  /** Id of a query currently being filled — its section streams agent
   *  activity inline. */
  liveQueryId: string | null;
  /** Streaming agent steps for the live query. */
  liveSteps: AgentStep[];
  /** When set, the discover hook deferred a submit because no Exa key
   *  is configured. Render a synthetic live section at the top with the
   *  Exa card so the prompt feels like the first step of an active
   *  discovery, not a pre-flight modal. */
  pendingDecision?: { text: string } | null;
}) {
  // Subscribe to cache invalidations so the queue re-renders.
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

  // Track Exa-key presence so the persistent "Enable web search" card
  // hides itself once the user actually adds a key.
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

  // Group recs by queryId (active vs dismissed) and queries into date
  // buckets. Memoized — these scan O(queries × recs) and the parent
  // re-renders on every storage event.
  const { activeByQuery, dismissedByQuery, acceptedByQuery } = useMemo(() => {
    const active = new Map<string, Recommendation[]>();
    const dismissed = new Map<string, number>();
    const accepted = new Map<string, number>();
    for (const rec of recs) {
      if (rec.dismissedAt) {
        dismissed.set(rec.queryId, (dismissed.get(rec.queryId) ?? 0) + 1);
      } else {
        const list = active.get(rec.queryId) ?? [];
        list.push(rec);
        active.set(rec.queryId, list);
      }
      if (isAccepted(rec, reviews)) {
        accepted.set(rec.queryId, (accepted.get(rec.queryId) ?? 0) + 1);
      }
    }
    // Within each query, render in the agent's submit_picks order (rank
    // ascending). Older recs with rank=0 sort to the top, which is fine —
    // they pre-date the rank column.
    for (const list of active.values()) {
      list.sort((a, b) => a.rank - b.rank);
    }
    return {
      activeByQuery: active,
      dismissedByQuery: dismissed,
      acceptedByQuery: accepted,
    };
  }, [recs, reviews]);

  const byBucket = useMemo(() => {
    const map = new Map<DateBucket, DiscoverQuery[]>();
    for (const q of queries) {
      const bucket = dateBucket(q.createdAt);
      const list = map.get(bucket) ?? [];
      list.push(q);
      map.set(bucket, list);
    }
    return map;
  }, [queries]);

  if (queries.length === 0 && !pendingDecision) return null;

  return (
    <div className="space-y-8">
      {pendingDecision ? (
        <div className="space-y-5">
          <MonoLabel>Now</MonoLabel>
          <PendingDecisionSection text={pendingDecision.text} />
        </div>
      ) : null}
      {BUCKET_ORDER.filter((b) => byBucket.has(b)).map((bucket) => {
        const bucketQueries = byBucket.get(bucket)!;
        return (
          <div key={bucket} className="space-y-5">
            <MonoLabel>{BUCKET_LABELS[bucket]}</MonoLabel>
            <div className="space-y-7">
              {bucketQueries.map((q) => (
                <QuerySection
                  key={q.id}
                  query={
                    q.id === liveQueryId ? { ...q, status: "running" } : q
                  }
                  recommendations={activeByQuery.get(q.id) ?? []}
                  dismissedCount={dismissedByQuery.get(q.id) ?? 0}
                  acceptedCount={acceptedByQuery.get(q.id) ?? 0}
                  // Today's queries default expanded; older ones collapsed
                  // to keep the queue scannable as it grows.
                  defaultCollapsed={
                    bucket !== "today" && q.id !== liveQueryId
                  }
                  liveSteps={
                    q.id === liveQueryId ? liveSteps : undefined
                  }
                  hasExaKey={hasExaKey}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
