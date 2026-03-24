"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronUp, ChevronDown, Sparkles, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExploreData } from "@/hooks/use-explore-data";
import type { Annotation } from "@/lib/annotations";
import type { Model } from "@/lib/models";
import type { AnalysisStatus } from "@/hooks/use-auto-analysis";
import PrerequisitesPanel from "./prerequisites-panel";
import AnnotationList from "./annotation-list";

export type ContextTab = "prerequisites" | "notes";

interface ContextZoneProps {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  selectedModel: Model | null;
  annotations: Annotation[];
  activeAnnotationId: string | null;
  hoveredAnnotationId: string | null;
  onAnnotationsChanged: () => void;
  onHighlightClick: (pageNumber: number) => void;
  onAnnotationHover: (annotationId: string | null) => void;
  onChatPrompt: (text: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeTab: ContextTab;
  onTabChange: (tab: ContextTab) => void;
  /** Brief flash animation when analysis completes */
  flash?: boolean;
  analysisStatus: AnalysisStatus;
  analysisProgress: string | null;
  analysisError: string | null;
  canRunAnalysis: boolean;
  onTriggerAnalysis: () => boolean;
  onOpenSettings: () => void;
}

export default function ContextZone({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  selectedModel,
  annotations,
  activeAnnotationId,
  hoveredAnnotationId,
  onAnnotationsChanged,
  onHighlightClick,
  onAnnotationHover,
  onChatPrompt,
  collapsed,
  onToggleCollapsed,
  activeTab,
  onTabChange,
  flash,
  analysisStatus,
  analysisProgress,
  analysisError,
  canRunAnalysis,
  onTriggerAnalysis,
  onOpenSettings,
}: ContextZoneProps) {
  const { prerequisites: prereqData } = useExploreData(reviewId);
  const [flashActive, setFlashActive] = useState(false);

  useEffect(() => {
    if (flash) {
      setFlashActive(true);
      const t = setTimeout(() => setFlashActive(false), 1200);
      return () => clearTimeout(t);
    }
  }, [flash]);

  const prereqCount = prereqData?.prerequisites?.length ?? 0;
  const prereqDone = prereqData?.prerequisites?.filter((p) => !!p.completedAt).length ?? 0;
  const notesCount = annotations.length;

  const handleAskAbout = useCallback(
    (topic: string) => {
      onChatPrompt(
        `Explain the prerequisite concept "${topic}" — specifically how it relates to this paper and what I need to understand.`,
      );
    },
    [onChatPrompt],
  );

  const tabs: { id: ContextTab; label: string; icon: typeof Sparkles; badge?: string }[] = [
    {
      id: "prerequisites",
      label: "Pre-reading",
      icon: Sparkles,
      badge: prereqCount > 0 ? `${prereqDone}/${prereqCount}` : undefined,
    },
    {
      id: "notes",
      label: "Notes",
      icon: StickyNote,
      badge: notesCount > 0 ? `${notesCount}` : undefined,
    },
  ];

  return (
    <div
      className={cn(
        "flex flex-col min-h-0 border-b border-border bg-background transition-[border-color] duration-300",
        flashActive && "border-b-primary/50",
      )}
    >
      {/* Header bar */}
      <div className="flex items-center gap-1 px-2 h-9 shrink-0 border-b border-border/60 bg-muted/20">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              if (collapsed) onToggleCollapsed();
              onTabChange(tab.id);
            }}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
              activeTab === tab.id && !collapsed
                ? "bg-background text-foreground shadow-sm border border-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
          >
            <tab.icon className="size-3" />
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.badge && (
              <span className="text-[10px] tabular-nums bg-muted text-muted-foreground rounded-full px-1.5 py-px ml-0.5">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          aria-label={collapsed ? "Expand context zone" : "Collapse context zone"}
        >
          {collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>
      </div>

      {/* Content area */}
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
          {activeTab === "prerequisites" && (
            <PrerequisitesPanel
              reviewId={reviewId}
              arxivId={arxivId}
              paperTitle={paperTitle}
              paperContext={paperContext}
              selectedModel={selectedModel}
              onAskAbout={handleAskAbout}
              analysisStatus={analysisStatus}
              analysisProgress={analysisProgress}
              analysisError={analysisError}
              canRunAnalysis={canRunAnalysis}
              onTriggerAnalysis={onTriggerAnalysis}
              onOpenSettings={onOpenSettings}
            />
          )}
          {activeTab === "notes" && (
            <AnnotationList
              reviewId={reviewId}
              annotations={annotations}
              activeAnnotationId={activeAnnotationId}
              hoveredAnnotationId={hoveredAnnotationId}
              onAnnotationsChanged={onAnnotationsChanged}
              onHighlightClick={onHighlightClick}
              onAnnotationHover={onAnnotationHover}
            />
          )}
        </div>
      )}
    </div>
  );
}
