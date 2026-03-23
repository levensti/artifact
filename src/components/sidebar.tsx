"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Plus,
  FileText,
  Settings,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  BookOpen,
} from "lucide-react";
import {
  getReviews,
  deleteReview,
  REVIEWS_UPDATED_EVENT,
  type PaperReview,
} from "@/lib/reviews";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import NewReviewDialog from "./new-review-dialog";

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
  const [reviews, setReviews] = useState<PaperReview[]>([]);
  const [showNewReview, setShowNewReview] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const refreshReviews = useCallback(() => {
    setReviews(getReviews());
  }, []);

  useEffect(() => {
    refreshReviews();
    window.addEventListener(REVIEWS_UPDATED_EVENT, refreshReviews);
    return () =>
      window.removeEventListener(REVIEWS_UPDATED_EVENT, refreshReviews);
  }, [refreshReviews]);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteReview(id);
    refreshReviews();
    if (pathname === `/review/${id}`) {
      router.push("/");
    }
  };

  const handleReviewCreated = (reviewId: string) => {
    setShowNewReview(false);
    refreshReviews();
    router.push(`/review/${reviewId}`);
  };

  const grouped = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const buckets: Record<string, PaperReview[]> = {
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };

    for (const r of reviews) {
      const d = new Date(r.createdAt).toISOString().split("T")[0];
      if (d === todayStr) buckets.today.push(r);
      else if (d === yesterdayStr) buckets.yesterday.push(r);
      else {
        const daysDiff = Math.floor(
          (today.getTime() - new Date(r.createdAt).getTime()) / 86400000,
        );
        if (daysDiff < 7) buckets.week.push(r);
        else buckets.older.push(r);
      }
    }

    const result: { label: string; items: PaperReview[] }[] = [];
    if (buckets.today.length)
      result.push({ label: "Today", items: buckets.today });
    if (buckets.yesterday.length)
      result.push({ label: "Yesterday", items: buckets.yesterday });
    if (buckets.week.length)
      result.push({ label: "This week", items: buckets.week });
    if (buckets.older.length)
      result.push({ label: "Older", items: buckets.older });
    return result;
  }, [reviews]);

  return (
    <>
      <aside
        className={cn(
          "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-sidebar shrink-0 overflow-hidden",
          collapsed ? "w-0 border-r-0" : "w-[260px]",
        )}
      >
        <div className="flex items-center justify-between px-3 h-[52px] shrink-0 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="size-7 rounded-lg bg-primary/12 ring-1 ring-primary/10 flex items-center justify-center shrink-0">
              <BookOpen size={14} className="text-primary" strokeWidth={1.75} />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground truncate">
              Paper Copilot
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={onToggle}
            title="Collapse sidebar"
          >
            <PanelLeftClose size={14} />
          </Button>
        </div>

        <div className="px-3 pt-3 pb-1 shrink-0">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 h-9 text-sm font-normal text-muted-foreground hover:text-foreground"
            onClick={() => setShowNewReview(true)}
          >
            <Plus size={14} />
            New review
          </Button>
        </div>

        <ScrollArea className="flex-1 px-2 py-2">
          {grouped.length === 0 && (
            <div className="px-3 py-10 text-center">
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
            <div key={group.label} className="mb-4">
              <p className="px-2 pb-2 text-xs font-medium text-muted-foreground/75 tracking-wide">
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
                      onMouseEnter={() => setHoveredId(review.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className={cn(
                        "group w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors duration-150 cursor-pointer",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <FileText size={13} className="shrink-0 opacity-40" />
                      <span className="truncate flex-1 text-sm">
                        {review.title}
                      </span>
                      {(hoveredId === review.id || isActive) && (
                        <button
                          type="button"
                          onClick={(e) => handleDelete(e, review.id)}
                          className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors shrink-0"
                          aria-label="Delete review"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </ScrollArea>

        <div className="px-3 py-2 border-t border-sidebar-border shrink-0">
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors duration-150 text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          >
            <Settings size={13} />
            API keys
          </button>
        </div>
      </aside>

      {collapsed && (
        <Button
          variant="outline"
          size="icon"
          className="fixed top-2 left-2 z-40 size-8 shadow-sm"
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
