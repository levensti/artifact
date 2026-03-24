"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Annotation } from "@/lib/annotations";
import type { Model } from "@/lib/models";
import type { AnalysisStatus } from "@/hooks/use-auto-analysis";
import { useSettingsOpener } from "./settings-opener-context";
import ChatPanel from "./chat-panel";
import AnnotationList from "./annotation-list";
import PrerequisitesPanel from "./prerequisites-panel";

export type RightTab = "assistant" | "notes" | "prereading";

interface RightPanelProps {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  pendingSelection: string | null;
  onSelectionConsumed: () => void;
  annotations: Annotation[];
  activeAnnotationId: string | null;
  hoveredAnnotationId: string | null;
  onAnnotationsChanged: () => void;
  onHighlightClick: (pageNumber: number) => void;
  onAnnotationHover: (annotationId: string | null) => void;
  selectedModel: Model | null;
  onModelChange: (model: Model | null) => void;
  analysisStatus: AnalysisStatus;
  analysisProgress: string | null;
  analysisError: string | null;
  canRunAnalysis: boolean;
  onTriggerAnalysis: () => boolean;
  activeTab: RightTab;
  onTabChange: (tab: RightTab) => void;
}

export default function RightPanel({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  pendingSelection,
  onSelectionConsumed,
  annotations,
  activeAnnotationId,
  hoveredAnnotationId,
  onAnnotationsChanged,
  onHighlightClick,
  onAnnotationHover,
  selectedModel,
  onModelChange,
  analysisStatus,
  analysisProgress,
  analysisError,
  canRunAnalysis,
  onTriggerAnalysis,
  activeTab,
  onTabChange,
}: RightPanelProps) {
  const { openSettings } = useSettingsOpener();

  // When analysis finishes, switch to prereading tab
  const prevStatus = useRef(analysisStatus);
  useEffect(() => {
    if (prevStatus.current === "running" && analysisStatus === "done") {
      onTabChange("prereading");
    }
    prevStatus.current = analysisStatus;
  }, [analysisStatus, onTabChange]);

  // Cross-feature: pre-fill chat from prereading "Ask about this"
  const [chatPrompt, setChatPrompt] = useState<string | null>(null);
  const handleAskAbout = useCallback((topic: string) => {
    setChatPrompt(
      `Explain the concept "${topic}" — specifically how it relates to this paper and what I need to understand.`,
    );
    onTabChange("assistant");
  }, [onTabChange]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Tab bar */}
      <div className="flex items-center px-4 h-11 border-b border-border shrink-0 gap-4">
        <TabButton active={activeTab === "assistant"} onClick={() => onTabChange("assistant")}>
          Assistant
        </TabButton>
        <TabButton active={activeTab === "notes"} onClick={() => onTabChange("notes")}>
          Notes
          {annotations.length > 0 && (
            <span className="ml-1.5 text-[10px] tabular-nums bg-muted text-muted-foreground rounded-full px-1.5 py-px">
              {annotations.length}
            </span>
          )}
        </TabButton>
        <TabButton active={activeTab === "prereading"} onClick={() => onTabChange("prereading")}>
          Pre-reading
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "assistant" && (
          <ChatPanel
            reviewId={reviewId}
            arxivId={arxivId}
            paperTitle={paperTitle}
            paperContext={paperContext}
            pendingSelection={pendingSelection}
            onSelectionConsumed={onSelectionConsumed}
            hideHeader
            externalPrompt={chatPrompt}
            onExternalPromptConsumed={() => setChatPrompt(null)}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
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
        {activeTab === "prereading" && (
          <div className="h-full overflow-y-auto overflow-x-hidden overscroll-contain">
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
              onOpenSettings={() => openSettings()}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative text-sm font-medium pb-px transition-colors flex items-center",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground/70",
      )}
    >
      {children}
      {active && (
        <span className="absolute -bottom-[9px] left-0 right-0 h-[2px] bg-foreground rounded-full" />
      )}
    </button>
  );
}
