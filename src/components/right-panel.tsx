"use client";

import { cn } from "@/lib/utils";
import type { Annotation } from "@/lib/annotations";
import ChatPanel from "./chat-panel";
import AnnotationList from "./annotation-list";

interface RightPanelProps {
  reviewId: string;
  paperContext: string;
  pendingSelection: string | null;
  onSelectionConsumed: () => void;
  annotations: Annotation[];
  activeAnnotationId: string | null;
  hoveredAnnotationId: string | null;
  onAnnotationsChanged: () => void;
  onHighlightClick: (pageNumber: number) => void;
  onAnnotationHover: (annotationId: string | null) => void;
  activeTab: "qa" | "notes";
  onTabChange: (tab: "qa" | "notes") => void;
}

export default function RightPanel({
  reviewId,
  paperContext,
  pendingSelection,
  onSelectionConsumed,
  annotations,
  activeAnnotationId,
  hoveredAnnotationId,
  onAnnotationsChanged,
  onHighlightClick,
  onAnnotationHover,
  activeTab,
  onTabChange,
}: RightPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Tab header */}
      <div className="flex items-center px-4 h-12 border-b border-border shrink-0 gap-4">
        <TabButton
          active={activeTab === "qa"}
          onClick={() => onTabChange("qa")}
        >
          Assistant
        </TabButton>
        <TabButton
          active={activeTab === "notes"}
          onClick={() => onTabChange("notes")}
        >
          Notes
          {annotations.length > 0 && (
            <span className="ml-1.5 text-[10px] tabular-nums bg-muted text-muted-foreground rounded-full px-1.5 py-px">
              {annotations.length}
            </span>
          )}
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "qa" ? (
          <ChatPanel
            reviewId={reviewId}
            paperContext={paperContext}
            pendingSelection={pendingSelection}
            onSelectionConsumed={onSelectionConsumed}
            hideHeader
          />
        ) : (
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
