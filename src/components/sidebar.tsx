"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Compass,
  FilePlus,
  FileText,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import {
  getReviews,
  normalizeArxivId,
  REVIEWS_UPDATED_EVENT,
  type PaperReview,
} from "@/lib/reviews";
import { getGlobalGraphData } from "@/lib/client-data";
import { EXPLORE_UPDATED_EVENT } from "@/lib/explore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import NewReviewDialog from "./new-review-dialog";

/** YYYY-MM-DD in the user's local timezone (do not use UTC from toISOString). */
function localDateKeyFromIso(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function subscribeReviews(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
  window.addEventListener(EXPLORE_UPDATED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
    window.removeEventListener(EXPLORE_UPDATED_EVENT, onStoreChange);
  };
}

function reviewsSnapshot() {
  const globalIds = (getGlobalGraphData()?.nodes ?? []).map((n) => n.arxivId);
  return JSON.stringify({ reviews: getReviews(), globalIds });
}

function reviewsServerSnapshot() {
  return JSON.stringify({ reviews: [], globalIds: [] });
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
}

export default function Sidebar({
  collapsed,
  onToggle,
  onOpenSettings,
}: SidebarProps) {
  const reviewsJson = useSyncExternalStore(
    subscribeReviews,
    reviewsSnapshot,
    reviewsServerSnapshot,
  );
  const { reviews, globalIds } = useMemo(() => {
    const parsed = JSON.parse(reviewsJson) as {
      reviews: PaperReview[];
      globalIds: string[];
    };
    return {
      reviews: parsed.reviews ?? [],
      globalIds: parsed.globalIds ?? [],
    };
  }, [reviewsJson]);
  const [showNewReview, setShowNewReview] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const handleReviewCreated = (reviewId: string) => {
    setShowNewReview(false);
    router.push(`/review/${reviewId}`);
  };

  const grouped = useMemo(() => {
    const byDate = new Map<string, PaperReview[]>();
    for (const r of reviews) {
      const dateKey = localDateKeyFromIso(r.createdAt);
      const list = byDate.get(dateKey) ?? [];
      list.push(r);
      byDate.set(dateKey, list);
    }

    // Sort date keys descending (most recent first)
    const sortedKeys = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

    return sortedKeys.map((dateKey) => {
      const [yy, mm, dd] = dateKey.split("-").map(Number);
      const d = new Date(yy, mm - 1, dd);
      const label = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return { label, items: byDate.get(dateKey)! };
    });
  }, [reviews]);

  const unreadDiscoverCount = useMemo(() => {
    const reviewed = new Set(
      reviews.filter((r) => r.arxivId).map((r) => normalizeArxivId(r.arxivId!)),
    );
    return globalIds.filter((id) => !reviewed.has(normalizeArxivId(id))).length;
  }, [reviews, globalIds]);

  return (
    <>
      <aside
        className={cn(
          "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-sidebar shrink-0 overflow-hidden",
          collapsed ? "w-0 border-r-0" : "w-[272px]",
        )}
      >
        <div className="shrink-0 space-y-2 border-b border-sidebar-border px-2.5 pb-3 pt-2.5">
          <div className="flex min-h-10 items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/6 text-primary shadow-sm shadow-primary/10">
                <FileText
                  className="size-[18px] text-primary/70"
                  strokeWidth={1.75}
                />
              </div>
              <div className="min-w-0 flex-1">
                <span className="block text-lg font-bold tracking-wide leading-none text-foreground">
                  Artifact
                </span>
                <p className="mt-1 text-[11px] font-medium leading-snug tracking-wide text-muted-foreground">
                  Discover the frontier
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="mt-0.5 size-8 shrink-0 text-muted-foreground hover:bg-sidebar-accent"
              onClick={onToggle}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="size-4" strokeWidth={1.75} />
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setShowNewReview(true)}
            title="Create a review from an arXiv link"
            className="flex w-full min-h-10 items-center gap-2 rounded-lg px-0 py-0 text-left text-sm font-medium text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              <FilePlus className="size-4 opacity-50" strokeWidth={1.75} />
            </span>
            Start a review
          </button>
          <button
            type="button"
            onClick={() => router.push("/discovery")}
            className={cn(
              "flex w-full min-h-10 items-center gap-2 rounded-lg px-0 pr-1.5 py-0 text-left text-sm font-medium transition-colors duration-150",
              pathname === "/discovery"
                ? "bg-sidebar-accent/40 text-sidebar-accent-foreground border-l-[3px] border-l-primary"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground border-l-[3px] border-l-transparent",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              <Compass className="size-4 opacity-50" strokeWidth={1.75} />
            </span>
            <span>Discover</span>
            {unreadDiscoverCount > 0 ? (
              <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold leading-none text-primary tabular-nums shadow-sm shadow-primary/10">
                {unreadDiscoverCount}
              </span>
            ) : null}
          </button>
        </div>

        <ScrollArea className="flex-1 px-2.5 py-2">
          {grouped.length === 0 && (
            <div className="py-10 text-center">
              <FileText
                size={18}
                className="mx-auto text-muted-foreground/40 mb-2"
              />
              <p className="px-1 text-xs leading-relaxed text-muted-foreground">
                No papers yet. Start a review from an arXiv link to read,
                annotate, and explore with your assistant.
              </p>
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
              <div className="border-l-2 border-l-border/40">
                {group.items.map((review) => {
                  const isActive = pathname === `/review/${review.id}`;
                  return (
                    <div
                      key={review.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/review/${review.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ")
                          router.push(`/review/${review.id}`);
                      }}
                      className={cn(
                        "w-full cursor-pointer rounded-r-lg px-2.5 py-2.5 -ml-[2px] text-left text-xs leading-relaxed transition-colors duration-150 border-l-[2px] border-b border-b-border/30 last:border-b-0",
                        isActive
                          ? "bg-sidebar-accent/40 font-medium text-sidebar-accent-foreground border-l-primary"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground border-l-transparent",
                      )}
                    >
                      {review.title}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </ScrollArea>

        <div className="border-t border-sidebar-border px-2.5 py-2 shrink-0">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full min-h-10 items-center gap-2 rounded-lg px-0 py-0 text-sm transition-colors duration-150 text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              <Settings className="size-4" strokeWidth={1.75} />
            </span>
            Manage API keys
          </button>
        </div>
      </aside>

      {collapsed && (
        <Button
          variant="outline"
          size="icon"
          className="fixed left-2 top-2 z-40 size-8 border-border bg-background"
          onClick={onToggle}
          title="Expand sidebar"
        >
          <PanelLeft size={14} />
        </Button>
      )}

      <NewReviewDialog
        open={showNewReview}
        onClose={() => setShowNewReview(false)}
        onCreated={handleReviewCreated}
      />
    </>
  );
}
