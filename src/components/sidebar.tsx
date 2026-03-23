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
import { getStudies, deleteStudy, type Study } from "@/lib/studies";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import NewStudyDialog from "./new-study-dialog";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const [studies, setStudies] = useState<Study[]>([]);
  const [showNewStudy, setShowNewStudy] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const refreshStudies = useCallback(() => {
    setStudies(getStudies());
  }, []);

  useEffect(() => {
    refreshStudies();
    window.addEventListener("studies-updated", refreshStudies);
    return () => window.removeEventListener("studies-updated", refreshStudies);
  }, [refreshStudies]);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteStudy(id);
    refreshStudies();
    if (pathname === `/study/${id}`) {
      router.push("/");
    }
  };

  const handleStudyCreated = (studyId: string) => {
    setShowNewStudy(false);
    refreshStudies();
    router.push(`/study/${studyId}`);
  };

  // Group studies by date (using ISO date strings for locale-independence)
  const grouped = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const buckets: Record<string, Study[]> = {
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };

    for (const s of studies) {
      const d = new Date(s.createdAt).toISOString().split("T")[0];
      if (d === todayStr) buckets.today.push(s);
      else if (d === yesterdayStr) buckets.yesterday.push(s);
      else {
        const daysDiff = Math.floor(
          (today.getTime() - new Date(s.createdAt).getTime()) / 86400000,
        );
        if (daysDiff < 7) buckets.week.push(s);
        else buckets.older.push(s);
      }
    }

    const result: { label: string; items: Study[] }[] = [];
    if (buckets.today.length) result.push({ label: "Today", items: buckets.today });
    if (buckets.yesterday.length) result.push({ label: "Yesterday", items: buckets.yesterday });
    if (buckets.week.length) result.push({ label: "This week", items: buckets.week });
    if (buckets.older.length) result.push({ label: "Older", items: buckets.older });
    return result;
  }, [studies]);

  return (
    <>
      <aside
        className={cn(
          "flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-sidebar shrink-0 overflow-hidden",
          collapsed ? "w-0 border-r-0" : "w-[260px]",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 h-12 shrink-0 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="size-6 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
              <BookOpen size={12} className="text-primary" />
            </div>
            <span className="text-[13px] font-semibold tracking-tight text-foreground truncate">
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

        {/* New Study */}
        <div className="px-3 pt-3 pb-1 shrink-0">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 h-8 text-[13px] font-normal text-muted-foreground"
            onClick={() => setShowNewStudy(true)}
          >
            <Plus size={14} />
            New study
          </Button>
        </div>

        {/* Studies List */}
        <ScrollArea className="flex-1 px-2 py-2">
          {grouped.length === 0 && (
            <div className="px-3 py-10 text-center">
              <FileText size={18} className="mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">No studies yet</p>
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-widest">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((study) => {
                  const isActive = pathname === `/study/${study.id}`;
                  return (
                    <button
                      key={study.id}
                      onClick={() => router.push(`/study/${study.id}`)}
                      onMouseEnter={() => setHoveredId(study.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className={cn(
                        "group w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <FileText size={13} className="shrink-0 opacity-40" />
                      <span className="truncate flex-1 text-[13px]">
                        {study.title}
                      </span>
                      {(hoveredId === study.id || isActive) && (
                        <button
                          onClick={(e) => handleDelete(e, study.id)}
                          className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors shrink-0"
                          aria-label="Delete study"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </ScrollArea>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-sidebar-border shrink-0">
          <button
            onClick={() => router.push("/settings")}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors",
              pathname === "/settings"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
            )}
          >
            <Settings size={13} />
            Settings
          </button>
        </div>
      </aside>

      {/* Collapsed toggle */}
      {collapsed && (
        <Button
          variant="outline"
          size="icon"
          className="fixed top-2 left-2 z-40 size-8"
          onClick={onToggle}
          title="Expand sidebar"
        >
          <PanelLeft size={14} />
        </Button>
      )}

      <NewStudyDialog
        open={showNewStudy}
        onClose={() => setShowNewStudy(false)}
        onCreated={handleStudyCreated}
      />
    </>
  );
}
