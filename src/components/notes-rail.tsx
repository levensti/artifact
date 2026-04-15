"use client";

import { StickyNote } from "lucide-react";
import AnnotationList from "@/components/annotation-list";
import type { Annotation } from "@/lib/annotations";

interface NotesRailProps {
  reviewId: string;
  annotations: Annotation[];
  activeAnnotationId: string | null;
  hoveredAnnotationId: string | null;
  onAnnotationsChanged: () => void;
  onHighlightClick: (annotationId: string, pageNumber: number) => void;
  onAnnotationHover: (annotationId: string | null) => void;
  onAnnotationSelect: (id: string) => void;
}

export default function NotesRail({
  reviewId,
  annotations,
  activeAnnotationId,
  hoveredAnnotationId,
  onAnnotationsChanged,
  onHighlightClick,
  onAnnotationHover,
  onAnnotationSelect,
}: NotesRailProps) {
  const count = annotations.length;

  return (
    <aside className="flex h-full min-h-0 w-full xl:w-[min(280px,32vw)] min-w-[220px] shrink-0 flex-col border-l border-border bg-sidebar">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-sidebar px-5">
        <div className="flex min-w-0 items-center gap-2">
          <StickyNote
            className="size-[15px] shrink-0 text-muted-foreground"
            strokeWidth={2}
            aria-hidden
          />
          <span className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            Notes
          </span>
        </div>
        {count > 0 ? (
          <span className="shrink-0 tabular-nums text-[11px] font-medium text-muted-foreground">
            {count}
          </span>
        ) : null}
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
      </div>
    </aside>
  );
}
