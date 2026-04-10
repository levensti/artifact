"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, ArrowRight, Compass, Clock } from "lucide-react";
import {
  getReviews,
  REVIEWS_UPDATED_EVENT,
  type PaperReview,
} from "@/lib/reviews";
import { Button } from "@/components/ui/button";
import PaperSummaryCard from "./paper-summary-card";

function subscribeReviews(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
  return () => window.removeEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
}

function reviewsSnapshot() {
  return JSON.stringify(getReviews());
}

function reviewsServerSnapshot() {
  return "[]";
}

interface DashboardFeedProps {
  onStartReview: () => void;
}

export default function DashboardFeed({ onStartReview }: DashboardFeedProps) {
  const router = useRouter();
  const reviewsJson = useSyncExternalStore(
    subscribeReviews,
    reviewsSnapshot,
    reviewsServerSnapshot,
  );

  const reviews: PaperReview[] = useMemo(
    () => JSON.parse(reviewsJson) as PaperReview[],
    [reviewsJson],
  );

  const handleNavigate = (id: string) => router.push(`/review/${id}`);

  // Capture current time once on mount (pure during subsequent renders)
  const [now] = useState(() => Date.now());

  // Split reviews into groups
  const { recent, needsSummary, withSummary } = useMemo(() => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const recentItems: PaperReview[] = [];
    const needsSummaryItems: PaperReview[] = [];
    const withSummaryItems: PaperReview[] = [];

    for (const r of reviews) {
      const age = now - new Date(r.updatedAt).getTime();
      const hasSummary = r.summary && (
        r.summary.takeaway || r.summary.method ||
        r.summary.result || r.summary.notes
      );

      if (hasSummary) {
        withSummaryItems.push(r);
      } else if (age > sevenDaysMs) {
        needsSummaryItems.push(r);
      } else {
        recentItems.push(r);
      }
    }

    return {
      recent: recentItems,
      needsSummary: needsSummaryItems,
      withSummary: withSummaryItems,
    };
  }, [reviews, now]);

  if (reviews.length === 0) return null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Your research
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {reviews.length} paper{reviews.length !== 1 ? "s" : ""} reviewed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => router.push("/discovery")}
          >
            <Compass className="size-3.5" strokeWidth={1.75} />
            Discover
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onStartReview}
          >
            New review
            <ArrowRight className="size-3" strokeWidth={2} />
          </Button>
        </div>
      </div>

      {/* Papers needing review */}
      {needsSummary.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Clock className="size-3.5 text-amber-600/70" strokeWidth={2} />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Revisit &amp; summarize
            </h2>
            <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-800 tabular-nums">
              {needsSummary.length}
            </span>
          </div>
          <div className="space-y-2.5">
            {needsSummary.map((r) => (
              <PaperSummaryCard key={r.id} review={r} onNavigate={handleNavigate} />
            ))}
          </div>
        </section>
      )}

      {/* Recent (in-progress, no summary yet) */}
      {recent.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <BookOpen className="size-3.5 text-primary/60" strokeWidth={2} />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              In progress
            </h2>
          </div>
          <div className="space-y-2.5">
            {recent.map((r) => (
              <PaperSummaryCard key={r.id} review={r} onNavigate={handleNavigate} />
            ))}
          </div>
        </section>
      )}

      {/* Papers with summaries */}
      {withSummary.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What you learned
            </h2>
            <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground tabular-nums">
              {withSummary.length}
            </span>
          </div>
          <div className="space-y-2.5">
            {withSummary.map((r) => (
              <PaperSummaryCard key={r.id} review={r} onNavigate={handleNavigate} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
