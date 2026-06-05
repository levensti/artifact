"use client";

import {
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  StickyNote,
} from "lucide-react";
import type { Model } from "@/lib/models";
import type { Annotation } from "@/lib/annotations";
import { cn } from "@/lib/utils";
import ChatPanel from "./chat-panel";
import AnnotationList from "./annotation-list";

export type RightPanelTab = "chat" | "notes";

interface RightPanelProps {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  annotations: Annotation[];
  chatThreadAnnotationId: string | null;
  onChatThreadChange: (id: string | null) => void;
  onAnnotationsPersist: () => void;
  selectedModel: Model | null;
  onModelChange: (model: Model | null) => void;
  sourceUrl?: string | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Which tab is showing — lifted so selecting/creating notes can switch it. */
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  // Notes-tab interaction (wired to the same handlers the viewer uses).
  activeAnnotationId: string | null;
  hoveredAnnotationId: string | null;
  onHighlightClick: (annotationId: string, pageNumber: number) => void;
  onAnnotationHover: (annotationId: string | null) => void;
  onAnnotationSelect: (id: string) => void;
  onAnnotationDeactivate: () => void;
}

/**
 * Paper workspace: a tabbed panel holding the assistant chat and the notes
 * list. Folding notes in here (instead of a standalone always-on rail) keeps
 * the reading surface clear — notes surface on hover in the document, and the
 * full list is one tab away.
 */
export default function RightPanel({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  annotations,
  chatThreadAnnotationId,
  onChatThreadChange,
  onAnnotationsPersist,
  selectedModel,
  onModelChange,
  sourceUrl,
  collapsed = false,
  onToggleCollapsed,
  activeTab,
  onTabChange,
  activeAnnotationId,
  hoveredAnnotationId,
  onHighlightClick,
  onAnnotationHover,
  onAnnotationSelect,
  onAnnotationDeactivate,
}: RightPanelProps) {
  const noteCount = annotations.length;

  if (collapsed && onToggleCollapsed) {
    return (
      <aside className="flex h-full min-h-0 w-9 shrink-0 flex-col items-center border-l border-border bg-background">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand panel"
          aria-label="Expand panel"
          className="flex h-14 w-full shrink-0 items-center justify-center border-b border-border text-muted-foreground hover:text-foreground hover:bg-muted/60"
        >
          <PanelRightOpen className="size-[15px]" strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            onTabChange("chat");
            onToggleCollapsed();
          }}
          title="Assistant"
          aria-label="Open assistant"
          className="flex h-11 w-full shrink-0 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60"
        >
          <Sparkles className="size-[15px]" strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            onTabChange("notes");
            onToggleCollapsed();
          }}
          title="Notes"
          aria-label="Open notes"
          className="flex w-full shrink-0 flex-col items-center gap-1 py-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/60"
        >
          <StickyNote className="size-[15px]" strokeWidth={2} aria-hidden />
          {noteCount > 0 ? (
            <span className="tabular-nums text-[11px] font-medium">
              {noteCount}
            </span>
          ) : null}
        </button>
      </aside>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background pl-3 pr-3">
        <div
          role="tablist"
          aria-label="Panel"
          className="flex items-center gap-0.5"
        >
          <TabButton
            active={activeTab === "chat"}
            onClick={() => onTabChange("chat")}
            icon={<Sparkles className="size-[14px]" strokeWidth={2} aria-hidden />}
          >
            Assistant
          </TabButton>
          <TabButton
            active={activeTab === "notes"}
            onClick={() => onTabChange("notes")}
            icon={
              <StickyNote className="size-[14px]" strokeWidth={2} aria-hidden />
            }
            count={noteCount}
          >
            Notes
          </TabButton>
        </div>
        {onToggleCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="Collapse panel"
            aria-label="Collapse panel"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <PanelRightClose className="size-[15px]" strokeWidth={2} aria-hidden />
          </button>
        ) : null}
      </header>

      {/* Both panes stay mounted so switching tabs never resets chat state. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className={cn("absolute inset-0", activeTab === "chat" ? "" : "hidden")}>
          <ChatPanel
            reviewId={reviewId}
            arxivId={arxivId}
            paperTitle={paperTitle}
            paperContext={paperContext}
            annotations={annotations}
            chatThreadAnnotationId={chatThreadAnnotationId}
            onChatThreadChange={onChatThreadChange}
            onAnnotationsPersist={onAnnotationsPersist}
            hideHeader
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            sourceUrl={sourceUrl}
          />
        </div>
        <div className={cn("absolute inset-0 flex flex-col", activeTab === "notes" ? "" : "hidden")}>
          <AnnotationList
            reviewId={reviewId}
            annotations={annotations}
            activeAnnotationId={activeAnnotationId}
            hoveredAnnotationId={hoveredAnnotationId}
            onAnnotationsChanged={onAnnotationsPersist}
            onHighlightClick={onHighlightClick}
            onAnnotationHover={onAnnotationHover}
            onAnnotationSelect={onAnnotationSelect}
            onAnnotationDeactivate={onAnnotationDeactivate}
          />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium tracking-tight transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
      )}
    >
      {icon}
      {children}
      {typeof count === "number" && count > 0 ? (
        <span
          className={cn(
            "ml-0.5 rounded-full px-1.5 py-px text-[10px] font-medium tabular-nums",
            active
              ? "bg-primary/12 text-primary"
              : "bg-muted-foreground/10 text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
