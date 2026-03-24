"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, Loader2, Settings, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Annotation } from "@/lib/annotations";
import type { Model } from "@/lib/models";
import type { AnalysisStatus } from "@/hooks/use-auto-analysis";
import { useSettingsOpener } from "./settings-opener-context";
import { Button } from "./ui/button";
import ChatPanel from "./chat-panel";
import AnnotationList from "./annotation-list";
import PrerequisitesPanel from "./prerequisites-panel";

export type RightTab = "assistant" | "notes" | "explore";

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

  // When analysis starts, switch to Assistant tab so the user sees live progress
  const prevStatus = useRef(analysisStatus);
  useEffect(() => {
    if (prevStatus.current !== "running" && analysisStatus === "running") {
      onTabChange("assistant");
    }
    prevStatus.current = analysisStatus;
  }, [analysisStatus, onTabChange]);

  // Cross-feature: pre-fill chat from Explore "Ask about this"
  const [chatPrompt, setChatPrompt] = useState<string | null>(null);
  const handleAskAbout = useCallback((topic: string) => {
    setChatPrompt(
      `Explain the concept "${topic}" — specifically how it relates to this paper and what I need to understand.`,
    );
    onTabChange("assistant");
  }, [onTabChange]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Analysis banner — above tabs, always visible when relevant */}
      <AnalysisBanner
        analysisStatus={analysisStatus}
        analysisProgress={analysisProgress}
        analysisError={analysisError}
        canRunAnalysis={canRunAnalysis}
        selectedModel={selectedModel}
        onTriggerAnalysis={onTriggerAnalysis}
        onOpenSettings={() => openSettings()}
      />

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
        <TabButton active={activeTab === "explore"} onClick={() => onTabChange("explore")}>
          Explore
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
            analysisStatus={analysisStatus}
            analysisProgress={analysisProgress}
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
        {activeTab === "explore" && (
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
              canRunAnalysis={canRunAnalysis}
              onTriggerAnalysis={onTriggerAnalysis}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Analysis banner                                                    */
/* ------------------------------------------------------------------ */

interface AnalysisBannerProps {
  analysisStatus: AnalysisStatus;
  analysisProgress: string | null;
  analysisError: string | null;
  canRunAnalysis: boolean;
  selectedModel: Model | null;
  onTriggerAnalysis: () => boolean;
  onOpenSettings: () => void;
}

/* ------------------------------------------------------------------ */
/*  Tiny external-store hook for the success flash                     */
/*  Avoids calling setState or Date.now() synchronously during render. */
/* ------------------------------------------------------------------ */

let _flashVisible = false;
let _flashTimer: ReturnType<typeof setTimeout> | null = null;
const _flashListeners = new Set<() => void>();

function _notifyFlash() {
  for (const fn of _flashListeners) fn();
}

function showFlash() {
  if (_flashTimer) clearTimeout(_flashTimer);
  _flashVisible = true;
  _notifyFlash();
  _flashTimer = setTimeout(() => {
    _flashVisible = false;
    _notifyFlash();
    _flashTimer = null;
  }, 4000);
}

function useSuccessFlash(analysisStatus: AnalysisStatus): boolean {
  const prev = useRef(analysisStatus);

  // Fire the flash when we transition running → done (inside an effect, not render)
  useEffect(() => {
    if (prev.current === "running" && analysisStatus === "done") {
      showFlash();
    }
    prev.current = analysisStatus;
  }, [analysisStatus]);

  return useSyncExternalStore(
    (cb) => { _flashListeners.add(cb); return () => { _flashListeners.delete(cb); }; },
    () => _flashVisible,
    () => false,
  );
}

function AnalysisBanner({
  analysisStatus,
  analysisProgress,
  analysisError,
  canRunAnalysis,
  selectedModel,
  onTriggerAnalysis,
  onOpenSettings,
}: AnalysisBannerProps) {
  // Track success flash via an external mutable store so render stays pure.
  const showSuccess = useSuccessFlash(analysisStatus);

  // ── Running ──
  if (analysisStatus === "running") {
    return (
      <div className="shrink-0 px-4 py-2.5 border-b border-primary/15 bg-primary/[0.03]">
        <div className="flex items-center gap-2.5">
          <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
          <p className="text-xs text-foreground/80 truncate">
            {analysisProgress ?? "Analyzing paper\u2026"}
          </p>
        </div>
      </div>
    );
  }

  // ── Just finished ──
  if (showSuccess && analysisStatus === "done") {
    return (
      <div
        className="shrink-0 px-4 py-2 border-b border-emerald-600/15 bg-emerald-50/40"
        style={{ animation: "fadeIn 200ms ease-out" }}
      >
        <div className="flex items-center gap-2">
          <Check className="size-3.5 text-emerald-600 shrink-0" />
          <p className="text-xs text-emerald-800/80">
            Analysis complete — related papers added to your knowledge graph
          </p>
        </div>
      </div>
    );
  }

  // ── Already analyzed — banner hidden ──
  if (analysisStatus === "done") {
    return null;
  }

  // ── Error ──
  if (analysisStatus === "error") {
    return (
      <div className="shrink-0 px-4 py-2.5 border-b border-destructive/15 bg-destructive/[0.04]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-destructive/90 truncate">
            {analysisError ?? "Analysis failed"}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-destructive hover:text-destructive shrink-0"
            onClick={onTriggerAnalysis}
            disabled={!canRunAnalysis}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // ── Idle — no model configured ──
  if (!selectedModel) {
    return (
      <div className="shrink-0 px-4 py-3 border-b border-border/60 bg-muted/25">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground/80">
              Analyze this paper
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Select a model and add an API key to discover related works.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] shrink-0"
            onClick={onOpenSettings}
          >
            <Settings className="size-3 mr-1.5" />
            Settings
          </Button>
        </div>
      </div>
    );
  }

  // ── Idle — model set but no API key ──
  if (!canRunAnalysis) {
    return (
      <div className="shrink-0 px-4 py-3 border-b border-border/60 bg-muted/25">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground/80">
              Analyze this paper
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Add an API key for {selectedModel.label} to get started.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] shrink-0"
            onClick={onOpenSettings}
          >
            <Settings className="size-3 mr-1.5" />
            Add key
          </Button>
        </div>
      </div>
    );
  }

  // ── Idle — ready to run ──
  return (
    <div className="shrink-0 px-4 py-3 border-b border-border/60 bg-muted/25">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground/80">
            Analyze this paper
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Find prerequisites, related works, and add to your knowledge graph.
          </p>
        </div>
        <Button
          size="sm"
          className="h-7 text-[11px] shrink-0"
          onClick={onTriggerAnalysis}
        >
          <Sparkles className="size-3 mr-1.5" />
          Analyze
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab button                                                         */
/* ------------------------------------------------------------------ */

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
