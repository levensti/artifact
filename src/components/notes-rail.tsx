"use client";

import { useState } from "react";
import { StickyNote, List } from "lucide-react";
import AnnotationList from "@/components/annotation-list";
import TableOfContents, { type TocEntry } from "@/components/table-of-contents";
import type { Annotation } from "@/lib/annotations";
import { cn } from "@/lib/utils";

interface NotesRailProps {
  reviewId: string;
  annotations: Annotation[];
  activeAnnotationId: string | null;
  hoveredAnnotationId: string | null;
  onAnnotationsChanged: () => void;
  onHighlightClick: (pageNumber: number) => void;
  onAnnotationHover: (annotationId: string | null) => void;
  onAnnotationSelect: (id: string) => void;
  tocEntries?: TocEntry[];
  currentPage?: number;
}

type RailTab = "notes" | "sections";

export default function NotesRail({
  reviewId,
  annotations,
  activeAnnotationId,
  hoveredAnnotationId,
  onAnnotationsChanged,
  onHighlightClick,
  onAnnotationHover,
  onAnnotationSelect,
  tocEntries = [],
  currentPage = 1,
}: NotesRailProps) {
  const [tab, setTab] = useState<RailTab>("notes");
  const count = annotations.length;
  const hasToc = tocEntries.length > 0;

  return (
    <aside className="flex h-full min-h-0 w-[min(280px,32vw)] min-w-[220px] shrink-0 flex-col border-l border-border bg-muted/15">
      <header className="shrink-0 border-b border-border bg-background" style={{ boxShadow: "var(--shadow-panel)" }}>
        <div className="flex h-12 items-center gap-0 px-1">
          <button
            type="button"
            onClick={() => setTab("notes")}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-150",
              tab === "notes"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <StickyNote className="size-3.5" strokeWidth={2} />
            Notes
            {count > 0 && (
              <span className="tabular-nums text-[10px] text-muted-foreground">
                {count}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("sections")}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-150",
              tab === "sections"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <List className="size-3.5" strokeWidth={2} />
            Sections
            {hasToc && (
              <span className="tabular-nums text-[10px] text-muted-foreground">
                {tocEntries.length}
              </span>
            )}
          </button>
        </div>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        {tab === "notes" ? (
          <AnnotationList
            reviewId={reviewId}
            annotations={annotations}
            activeAnnotationId={activeAnnotationId}
            hoveredAnnotationId={hoveredAnnotationId}
            onAnnotationsChanged={onAnnotationsChanged}
            onHighlightClick={onHighlightClick}
            onAnnotationHover={onAnnotationHover}
            onAnnotationSelect={onAnnotationSelect}
            density="rail"
          />
        ) : (
          <TableOfContents
            entries={tocEntries}
            currentPage={currentPage}
            onNavigate={onHighlightClick}
          />
        )}
      </div>
    </aside>
  );
}
