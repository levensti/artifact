"use client";

import { useState } from "react";
import {
  PanelRightClose,
  PanelRightOpen,
  MessageSquare,
  StickyNote,
  LayoutPanelTop,
} from "lucide-react";
import type { Annotation } from "@/lib/annotations";
import { cn } from "@/lib/utils";
import ChatPanel from "./chat-panel";
import AnnotationList from "./annotation-list";
import ArtifactsPanel from "./artifacts-panel";
import { ArtifactOpenerContext } from "./artifact-view";
import type { ArtifactContent } from "@/lib/artifacts";
import { useArtifacts } from "@/hooks/use-artifacts";

export type RightPanelTab = "chat" | "notes" | "artifacts";

interface RightPanelProps {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  annotations: Annotation[];
  chatThreadAnnotationId: string | null;
  onChatThreadChange: (id: string | null) => void;
  onAnnotationsPersist: () => void;
  modelReady: boolean;
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
  modelReady,
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
  const artifacts = useArtifacts(reviewId);
  const artifactCount = artifacts.artifacts.length;
  // The artifact open in the Artifacts tab. Cards in chat open it here too,
  // so a citation chip can scroll the PDF while it stays beside it.
  const [openArtifact, setOpenArtifact] = useState<ArtifactContent | null>(
    null,
  );
  const openArtifactInTab = (artifact: ArtifactContent) => {
    setOpenArtifact(artifact);
    onTabChange("artifacts");
  };

  // Dot on the Artifacts tab when one arrives while the user is looking
  // elsewhere (another tab, or the panel collapsed); cleared on opening it.
  // Artifacts that already existed when the page loaded don't count. State
  // is adjusted during render (guarded), React's alternative to an effect.
  const viewingArtifacts = activeTab === "artifacts" && !collapsed;
  const artifactIds = artifacts.artifacts.map((a) => a.id);
  const [seenArtifactIds, setSeenArtifactIds] = useState<string[] | null>(null);
  const hasUnseenArtifact =
    seenArtifactIds !== null &&
    artifactIds.some((id) => !seenArtifactIds.includes(id));
  if (artifacts.loaded && seenArtifactIds === null) {
    setSeenArtifactIds(artifactIds);
  } else if (viewingArtifacts && hasUnseenArtifact) {
    setSeenArtifactIds(artifactIds);
  }
  const unseenArtifact = hasUnseenArtifact && !viewingArtifacts;

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
          <MessageSquare className="size-[15px]" strokeWidth={2} aria-hidden />
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
        <button
          type="button"
          onClick={() => {
            onTabChange("artifacts");
            onToggleCollapsed();
          }}
          title="Artifacts"
          aria-label="Open artifacts"
          className="flex w-full shrink-0 flex-col items-center gap-1 py-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/60"
        >
          <span className="relative">
            <LayoutPanelTop
              className="size-[15px]"
              strokeWidth={2}
              aria-hidden
            />
            {unseenArtifact ? (
              <NewDot className="absolute -right-1 -top-1" />
            ) : null}
          </span>
          {artifactCount > 0 ? (
            <span className="tabular-nums text-[11px] font-medium">
              {artifactCount}
            </span>
          ) : null}
        </button>
      </aside>
    );
  }

  return (
    <ArtifactOpenerContext.Provider value={openArtifactInTab}>
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
            >
              Assistant
            </TabButton>
            <TabButton
              active={activeTab === "notes"}
              onClick={() => onTabChange("notes")}
              count={noteCount}
            >
              Notes
            </TabButton>
            <TabButton
              active={activeTab === "artifacts"}
              onClick={() => onTabChange("artifacts")}
              count={artifactCount}
              dot={unseenArtifact}
            >
              Artifacts
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
              <PanelRightClose
                className="size-[15px]"
                strokeWidth={2}
                aria-hidden
              />
            </button>
          ) : null}
        </header>

        {/* All panes stay mounted so switching tabs never resets chat state. */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "absolute inset-0",
              activeTab === "chat" ? "" : "hidden",
            )}
          >
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
              modelReady={modelReady}
              sourceUrl={sourceUrl}
            />
          </div>
          <div
            className={cn(
              "absolute inset-0 flex flex-col",
              activeTab === "notes" ? "" : "hidden",
            )}
          >
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
          <div
            className={cn(
              "absolute inset-0 flex flex-col",
              activeTab === "artifacts" ? "" : "hidden",
            )}
          >
            <ArtifactsPanel
              artifacts={artifacts.artifacts}
              loaded={artifacts.loaded}
              openArtifact={openArtifact}
              onClose={() => setOpenArtifact(null)}
            />
          </div>
        </div>
      </div>
    </ArtifactOpenerContext.Provider>
  );
}

/** Small accent dot marking something new behind a tab. */
function NewDot({ className }: { className?: string }) {
  return (
    <span
      className={cn("size-1.5 rounded-full bg-primary", className)}
      aria-label="New"
      role="img"
    />
  );
}

function TabButton({
  active,
  onClick,
  count,
  dot,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  /** Marks unseen content (e.g. a newly built artifact). */
  dot?: boolean;
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
      {children}
      {typeof count === "number" && count > 0 ? (
        <span className="ml-0.5 font-mono text-[11px] font-normal tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
      {dot ? <NewDot /> : null}
    </button>
  );
}
