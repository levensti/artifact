"use client";

import { useCallback, useEffect, useState } from "react";
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
    // Listen for storage events from other components
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

  // Group studies by date
  const today = new Date();
  const todayStr = today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  const grouped: { label: string; items: Study[] }[] = [];
  const todayItems: Study[] = [];
  const yesterdayItems: Study[] = [];
  const thisWeekItems: Study[] = [];
  const olderItems: Study[] = [];

  for (const s of studies) {
    const d = new Date(s.createdAt).toDateString();
    if (d === todayStr) todayItems.push(s);
    else if (d === yesterdayStr) yesterdayItems.push(s);
    else {
      const daysDiff = Math.floor((today.getTime() - new Date(s.createdAt).getTime()) / 86400000);
      if (daysDiff < 7) thisWeekItems.push(s);
      else olderItems.push(s);
    }
  }

  if (todayItems.length) grouped.push({ label: "Today", items: todayItems });
  if (yesterdayItems.length) grouped.push({ label: "Yesterday", items: yesterdayItems });
  if (thisWeekItems.length) grouped.push({ label: "This week", items: thisWeekItems });
  if (olderItems.length) grouped.push({ label: "Older", items: olderItems });

  return (
    <>
      <aside
        className={cn(
          "flex flex-col h-full bg-bg-secondary border-r border-border transition-sidebar shrink-0 overflow-hidden",
          collapsed ? "w-0 border-r-0" : "w-64",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-accent-muted flex items-center justify-center shrink-0">
              <BookOpen size={14} className="text-accent" />
            </div>
            <span className="text-sm font-semibold truncate tracking-tight">
              Paper Copilot
            </span>
          </div>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        {/* New Study Button */}
        <div className="px-3 mb-2 shrink-0">
          <button
            onClick={() => setShowNewStudy(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border-light hover:border-accent/30 hover:bg-accent-subtle text-sm text-text-secondary hover:text-text-primary transition-all"
          >
            <Plus size={14} />
            New study
          </button>
        </div>

        {/* Studies List */}
        <div className="flex-1 overflow-auto px-2 pb-2">
          {grouped.length === 0 && (
            <div className="px-3 py-8 text-center">
              <FileText size={20} className="mx-auto text-text-muted mb-2 opacity-50" />
              <p className="text-xs text-text-muted">No studies yet</p>
              <p className="text-xs text-text-muted mt-0.5">
                Create one to get started
              </p>
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-2 py-1.5 text-[11px] font-medium text-text-muted uppercase tracking-wider">
                {group.label}
              </p>
              {group.items.map((study) => {
                const isActive = pathname === `/study/${study.id}`;
                return (
                  <button
                    key={study.id}
                    onClick={() => router.push(`/study/${study.id}`)}
                    onMouseEnter={() => setHoveredId(study.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={cn(
                      "group w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors text-sm",
                      isActive
                        ? "bg-bg-active text-text-primary"
                        : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
                    )}
                  >
                    <FileText size={14} className="shrink-0 opacity-50" />
                    <span className="truncate flex-1 text-[13px]">
                      {study.title}
                    </span>
                    {(hoveredId === study.id || isActive) && (
                      <button
                        onClick={(e) => handleDelete(e, study.id)}
                        className="p-0.5 rounded hover:bg-danger-muted hover:text-danger text-text-muted transition-colors shrink-0"
                        aria-label="Delete study"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-border shrink-0">
          <button
            onClick={() => router.push("/settings")}
            className={cn(
              "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition-colors",
              pathname === "/settings"
                ? "bg-bg-active text-text-primary"
                : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
            )}
          >
            <Settings size={14} />
            Settings
          </button>
        </div>
      </aside>

      {/* Collapsed toggle */}
      {collapsed && (
        <button
          onClick={onToggle}
          className="fixed top-3 left-3 z-40 p-2 rounded-lg bg-bg-secondary border border-border hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          aria-label="Expand sidebar"
        >
          <PanelLeft size={16} />
        </button>
      )}

      <NewStudyDialog
        open={showNewStudy}
        onClose={() => setShowNewStudy(false)}
        onCreated={handleStudyCreated}
      />
    </>
  );
}
