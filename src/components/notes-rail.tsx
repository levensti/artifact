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
  onHighlightClick: (pageNumber: number) => void;
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
    <aside className="flex h-full min-h-0 w-[min(280px,32vw)] min-w-[220px] shrink-0 flex-col border-l border-border bg-muted/15">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/80 bg-background/80 px-4 backdrop-blur-sm">
        <StickyNote
          className="size-[15px] shrink-0 text-muted-foreground"
          strokeWidth={2}
        />
        <span className="text-xs font-semibold leading-none tracking-tight text-foreground">
          Notes
        </span>
        {count > 0 && (
          <span className="ml-auto tabular-nums text-[10px] font-medium leading-none text-muted-foreground">
            {count}
          </span>
        )}
      </div>
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
