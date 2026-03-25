"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Plus,
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
import {
  getGlobalGraphData,
  EXPLORE_UPDATED_EVENT,
} from "@/lib/explore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import NewReviewDialog from "./new-review-dialog";

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

  // Track whether the knowledge graph has any entries
  const [hasGraphData, setHasGraphData] = useState(() => {
    const g = getGlobalGraphData();
    return g !== null && g.nodes.length > 0;
  });
  useEffect(() => {
    const check = () => {
      const g = getGlobalGraphData();
      setHasGraphData(g !== null && g.nodes.length > 0);
    };
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
      const dateKey = new Date(r.createdAt).toISOString().split("T")[0];
      const list = byDate.get(dateKey) ?? [];
      list.push(r);
      byDate.set(dateKey, list);
    }

    // Sort date keys descending (most recent first)
    const sortedKeys = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

    return sortedKeys.map((dateKey) => {
      const d = new Date(dateKey + "T12:00:00"); // noon to avoid timezone shift
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return { label, items: byDate.get(dateKey)! };
    });
  }, [reviews]);

  return (
    <>
      <aside
        className={cn(
          "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-sidebar shrink-0 overflow-hidden",
          collapsed ? "w-0 border-r-0" : "w-[260px]",
        )}
      >
        <div className="flex items-center justify-between px-3 h-12 shrink-0 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="size-7 rounded-lg bg-primary/12 ring-1 ring-primary/10 flex items-center justify-center shrink-0">
              <ScrollText size={14} className="text-primary" strokeWidth={1.75} />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground truncate">
              Artifact
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs gap-1"
              onClick={() => setShowNewReview(true)}
              title="New paper review"
            >
              <Plus size={12} />
              New
            </Button>
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
        </div>

        <ScrollArea className="flex-1 px-2 py-2">
          {hasGraphData && (
            <div className="mb-4 space-y-0.5">
              <NavItem
                label="Knowledge Graph"
                icon={<Network size={13} className="shrink-0 opacity-50" />}
                active={pathname === "/discover"}
                onClick={() => router.push("/discover")}
              />
            </div>
          )}

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
                      className={cn(
                        "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors duration-150 cursor-pointer",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <FileText size={13} className="shrink-0 opacity-40" />
                      <span className="truncate flex-1 text-sm">
                        {review.title}
                      </span>
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
        "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm transition-colors duration-150",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
          : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
