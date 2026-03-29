"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  FilePlus,
  FileText,
  Settings,
  PanelLeftClose,
  PanelLeft,
  ScrollText,
  Network,
} from "lucide-react";
import {
  getReviews,
  REVIEWS_UPDATED_EVENT,
  type PaperReview,
} from "@/lib/reviews";
import { EXPLORE_UPDATED_EVENT } from "@/lib/explore";
import { getGlobalGraphData } from "@/lib/client-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TextTooltip, TooltipProvider } from "@/components/ui/tooltip";
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
  return () => window.removeEventListener(REVIEWS_UPDATED_EVENT, onStoreChange);
}

function reviewsSnapshot() {
  return JSON.stringify(getReviews());
}

function reviewsServerSnapshot() {
  return "[]";
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
  const reviews = useMemo(
    () => JSON.parse(reviewsJson) as PaperReview[],
    [reviewsJson],
  );
  const [showNewReview, setShowNewReview] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Client-only: avoid SSR/client mismatch (local graph exists only in the browser).
  const [hasGraphData, setHasGraphData] = useState(false);
  useEffect(() => {
    const check = () => {
      const g = getGlobalGraphData();
      setHasGraphData(g !== null && g.nodes.length > 0);
    };
    check();
    window.addEventListener(EXPLORE_UPDATED_EVENT, check);
    return () => window.removeEventListener(EXPLORE_UPDATED_EVENT, check);
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

  return (
    <>
      <aside
        className={cn(
          "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-sidebar shrink-0 overflow-hidden",
          collapsed ? "w-0 border-r-0" : "w-[272px]",
        )}
      >
        <div className="shrink-0 space-y-1 border-b border-sidebar-border px-2.5 pb-2.5 pt-2.5">
          <div className="flex min-h-10 items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                <ScrollText
                  className="size-[18px] text-foreground/80"
                  strokeWidth={1.75}
                />
              </div>
              <span className="text-lg font-semibold tracking-tight leading-none text-foreground">
                Artifact
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:bg-sidebar-accent"
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
            title="Start a new paper review"
            className="flex w-full min-h-10 items-center gap-2 rounded-lg px-0 py-0 text-left text-sm text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              <FilePlus
                className="size-4 opacity-50"
                strokeWidth={1.75}
              />
            </span>
            New paper review
          </button>
        </div>

        <TooltipProvider delay={100}>
          <ScrollArea className="flex-1 px-2.5 py-2">
            {hasGraphData && (
              <div className="mb-4 space-y-0.5">
                <NavItem
                  label="Knowledge Graph"
                  icon={
                    <Network
                      className="size-4 opacity-50"
                      strokeWidth={1.75}
                    />
                  }
                  active={pathname === "/discover"}
                  onClick={() => router.push("/discover")}
                />
              </div>
            )}

            {grouped.length === 0 && (
              <div className="py-10 text-center">
                <FileText
                  size={18}
                  className="mx-auto text-muted-foreground/40 mb-2"
                />
                <p className="text-xs text-muted-foreground leading-relaxed px-1">
                  No reviews yet. Start one to read a paper and keep your Q&amp;A
                  in one place.
                </p>
              </div>
            )}
            {grouped.map((group) => (
              <div key={group.label} className="mb-4 last:mb-0">
                <p className="pb-1.5 text-xs font-medium text-muted-foreground">
                  {group.label}
                </p>
                <div className="space-y-0.5">
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
                          "flex w-full min-h-10 cursor-pointer items-center gap-2 rounded-lg px-0 py-0 text-left text-sm leading-snug transition-colors duration-150",
                          isActive
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                          <FileText
                            className="size-4 opacity-40"
                            strokeWidth={1.75}
                          />
                        </span>
                        <TextTooltip label={review.title} side="right" />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </ScrollArea>
        </TooltipProvider>

        <div className="border-t border-sidebar-border px-2.5 py-2 shrink-0">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full min-h-10 items-center gap-2 rounded-lg px-0 py-0 text-sm transition-colors duration-150 text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              <Settings className="size-4" strokeWidth={1.75} />
            </span>
            API keys
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

function NavItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full min-h-10 items-center gap-2 rounded-lg px-0 py-0 text-left text-sm leading-snug transition-colors duration-150",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center [&_svg]:shrink-0">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
