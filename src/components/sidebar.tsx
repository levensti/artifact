"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  FilePen,
  FilePlus,
  AlertCircle,
  Share2,
} from "lucide-react";
import { canShareReview } from "@/lib/client/sharing/export-review";
import {
  getReviews,
  REVIEWS_UPDATED_EVENT,
  type PaperReview,
} from "@/lib/reviews";
import { getWikiCacheSnapshot, loadWikiPages } from "@/lib/client-data";
import { WIKI_UPDATED_EVENT } from "@/lib/storage-events";
import {
  getWikiIngestError,
  getWikiIngestSnapshot,
  reportWikiIngestError,
  subscribeWikiStatus,
} from "@/lib/wiki-status";
import { cn } from "@/lib/utils";
import { localDateKey, localDateKeyFromIso } from "@/lib/date-keys";
import { ScrollArea } from "@/components/ui/scroll-area";
import NewReviewDialog from "./new-review-dialog";
import ImportBundleDialog from "./import-bundle-dialog";
import ShareReviewDialog from "./share-review-dialog";
import UserMenu from "./user-menu";

function subscribeReviews(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
  window.addEventListener(WIKI_UPDATED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
    window.removeEventListener(WIKI_UPDATED_EVENT, onStoreChange);
  };
}

function reviewsSnapshot() {
  const wikiPages = getWikiCacheSnapshot() ?? [];
  return JSON.stringify({
    reviews: getReviews(),
    wikiPageCount: wikiPages.length,
  });
}

function reviewsServerSnapshot() {
  return JSON.stringify({ reviews: [], wikiPageCount: 0 });
}

interface SidebarProps {
  collapsed: boolean;
  /** Narrow screens: `overlay` = fixed drawer; `inline` = flex column (or w-0 when collapsed). */
  presentation?: "inline" | "overlay";
}

export default function Sidebar({
  collapsed,
  presentation = "inline",
}: SidebarProps) {
  const reviewsJson = useSyncExternalStore(
    subscribeReviews,
    reviewsSnapshot,
    reviewsServerSnapshot,
  );
  const { reviews, wikiPageCount } = useMemo(() => {
    const parsed = JSON.parse(reviewsJson) as {
      reviews: PaperReview[];
      wikiPageCount: number;
    };
    return {
      reviews: parsed.reviews ?? [],
      wikiPageCount: parsed.wikiPageCount ?? 0,
    };
  }, [reviewsJson]);

  // Ambient ingest status — shows a pulsing dot + label beside the
  // Journal button whenever a background wiki operation is in flight.
  const activeIngests = useSyncExternalStore(
    subscribeWikiStatus,
    getWikiIngestSnapshot,
    getWikiIngestSnapshot,
  );
  const ingestError = useSyncExternalStore(
    subscribeWikiStatus,
    getWikiIngestError,
    () => null,
  );
  const ingestActive = activeIngests.length > 0;
  const ingestLabel = useMemo(() => {
    if (activeIngests.length === 0) return null;
    if (activeIngests.length === 1) {
      const only = activeIngests[0];
      if (only.kind === "journal") return "Journaling…";
      return "Syncing…";
    }
    return `${activeIngests.length} running`;
  }, [activeIngests]);
  const [showNewReview, setShowNewReview] = useState(false);
  const [importMode, setImportMode] = useState<"review" | "journal" | null>(
    null,
  );
  const [importInitialFile, setImportInitialFile] = useState<File | null>(null);
  const [shareTarget, setShareTarget] = useState<PaperReview | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Ensure wiki cache is populated so the snapshot picks up page counts
  useEffect(() => {
    void loadWikiPages().catch(() => {
      // Sidebar polls on a cadence via WIKI_UPDATED_EVENT — failures here
      // are non-fatal and would otherwise pollute devtools with noise.
    });
  }, []);

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

    const sortedKeys = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

    const todayKey = localDateKey();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayKey = localDateKey(yesterdayDate);

    const now = new Date();
    const sameYear = (y: number) => y === now.getFullYear();

    return sortedKeys.map((dateKey) => {
      const [yy, mm, dd] = dateKey.split("-").map(Number);
      const d = new Date(yy, mm - 1, dd);
      const short = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(sameYear(yy) ? {} : { year: "numeric" }),
      });
      let label = short;
      if (dateKey === todayKey) label = `Today · ${short}`;
      else if (dateKey === yesterdayKey) label = `Yesterday · ${short}`;
      return { key: dateKey, label, items: byDate.get(dateKey)! };
    });
  }, [reviews]);

  // Wiki page count comes from the snapshot (no extra memo needed)

  return (
    <>
      <aside
        className={cn(
          "flex flex-col h-full bg-sidebar border-r border-sidebar-border overflow-hidden",
          presentation === "overlay"
            ? "fixed inset-y-0 left-0 z-40 w-[min(272px,85vw)] shrink-0 shadow-xl shadow-black/10 safe-area-x"
            : "shrink-0 transition-sidebar",
          presentation === "inline" &&
            (collapsed ? "w-0 border-r-0" : "w-[272px]"),
        )}
      >
        <div className="shrink-0 px-2 pb-2 pt-5">
          <div className="mb-4 flex items-start justify-between gap-2 px-2">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-foreground">
                <svg viewBox="4 4 24 24" aria-hidden className="size-[18px]">
                  <path d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z" fill="#fafafa" opacity="0.35"/>
                  <circle cx="22" cy="10" r="3.2" fill="#fafafa"/>
                </svg>
              </span>
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[18px] font-bold tracking-[-0.025em] text-foreground">
                  Artifact
                </span>
                <span className="truncate text-[11px] font-normal text-muted-foreground/70">
                  Discover the frontier
                </span>
              </div>
            </div>
            <a
              href="https://github.com/levensti/artifact"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View Artifact on GitHub"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground/80 transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
                className="size-[22px]"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.486 2 12.02c0 4.424 2.865 8.178 6.839 9.504.5.092.682-.218.682-.483 0-.237-.009-.866-.013-1.7-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.071 1.531 1.032 1.531 1.032.892 1.531 2.341 1.089 2.91.832.092-.648.35-1.09.636-1.341-2.22-.253-4.555-1.113-4.555-4.954 0-1.094.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.845c.85.004 1.705.115 2.504.337 1.909-1.296 2.748-1.027 2.748-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.594 1.028 2.688 0 3.85-2.339 4.697-4.566 4.946.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.481A10.02 10.02 0 0 0 22 12.02C22 6.486 17.523 2 12 2Z"
                />
              </svg>
            </a>
          </div>
          <button
            type="button"
            onClick={() => setShowNewReview(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground/80 transition-colors duration-150 hover:bg-sidebar-accent/60 hover:text-foreground"
          >
            <span className="flex w-6 shrink-0 items-center justify-center">
              <FilePlus
                className="size-3.75 text-primary/85"
                strokeWidth={1.75}
              />
            </span>
            <span className="truncate">Start a review</span>
          </button>
          <button
            type="button"
            onClick={() => router.push("/journal")}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150",
              pathname === "/journal"
                ? "bg-sidebar-accent text-foreground font-medium"
                : "text-foreground/80 hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <span className="relative flex w-6 shrink-0 items-center justify-center">
              <FilePen className="size-[15px] opacity-80" strokeWidth={1.75} />
              {ingestActive ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-primary animate-pulse"
                />
              ) : null}
            </span>
            <span className="truncate">Journal</span>
            {ingestActive ? (
              <span className="ml-auto text-[10px] font-medium italic text-primary/80 animate-pulse">
                {ingestLabel}
              </span>
            ) : null}
            {wikiPageCount > 0 && !ingestActive ? (
              <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-sidebar-accent/80 px-1.5 py-0.5 tabular-nums text-[10px] font-semibold text-muted-foreground">
                {wikiPageCount}
              </span>
            ) : null}
          </button>
          {ingestError ? (
            <div
              className="mx-1 mt-2 flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[10px] leading-snug text-destructive"
              role="status"
            >
              <AlertCircle className="mt-px size-3 shrink-0" strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate" title={ingestError}>
                Ingest failed — {ingestError}
              </span>
              <button
                type="button"
                onClick={() => reportWikiIngestError(null)}
                className="shrink-0 opacity-60 hover:opacity-100"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ) : null}
        </div>

        <div className="mx-2 mt-3 mb-1 shrink-0 border-t border-sidebar-border/60 pt-2">
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/50">
            Reviews
          </p>
        </div>

        <ScrollArea className="min-h-0 flex-1 px-2 pb-2 pt-1">
          {grouped.length === 0 && (
            <div className="mx-2 mt-8 flex flex-col items-center gap-2 text-center">
              <FilePlus
                className="size-5 text-muted-foreground/50"
                strokeWidth={1.5}
              />
              <p className="text-[12px] leading-relaxed text-muted-foreground/70">
                Your reviews will appear here.
              </p>
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.key} className="mb-5 last:mb-0">
              <p className="sticky top-0 z-10 mb-1 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/45 bg-sidebar/95 backdrop-blur-sm">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((review) => {
                  const isActive = pathname === `/review/${review.id}`;
                  const isImported = Boolean(review.importedAt);
                  const shareable = canShareReview(review);
                  return (
                    <div
                      key={review.id}
                      role="link"
                      tabIndex={0}
                      title={
                        isImported
                          ? `${review.title} — imported from a share`
                          : review.title
                      }
                      onClick={() => router.push(`/review/${review.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(`/review/${review.id}`);
                        }
                      }}
                      className={cn(
                        "group relative flex w-full cursor-pointer items-start gap-1.5 break-words rounded-md px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
                        isActive
                          ? "bg-sidebar-accent font-medium text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                      )}
                    >
                      <span className="min-w-0 flex-1 break-words">
                        {review.title}
                      </span>
                      {isImported ? (
                        <span
                          className="mt-px inline-flex shrink-0 items-center rounded-full bg-[var(--badge-imported-bg)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--badge-imported-fg)]"
                          aria-label="Imported from a shared bundle"
                        >
                          Imported
                        </span>
                      ) : null}
                      {shareable ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShareTarget(review);
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          title="Share this review"
                          aria-label={`Share ${review.title}`}
                          className={cn(
                            "mt-px inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring/60",
                            isActive
                              ? "opacity-90"
                              : "opacity-40 group-hover:opacity-90 group-focus-within:opacity-90",
                          )}
                        >
                          <Share2 className="size-3" strokeWidth={2} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </ScrollArea>

        <UserMenu />
      </aside>

      <NewReviewDialog
        open={showNewReview}
        onClose={() => setShowNewReview(false)}
        onCreated={handleReviewCreated}
        onImport={(file) => {
          setShowNewReview(false);
          setImportInitialFile(file ?? null);
          setImportMode("review");
        }}
      />
      <ImportBundleDialog
        open={importMode !== null}
        mode={importMode ?? "review"}
        initialFile={importInitialFile}
        onClose={() => {
          setImportMode(null);
          setImportInitialFile(null);
        }}
      />
      <ShareReviewDialog
        review={shareTarget}
        onClose={() => setShareTarget(null)}
      />
    </>
  );
}
