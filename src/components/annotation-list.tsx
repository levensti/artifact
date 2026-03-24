"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Annotation, updateAnnotation, deleteAnnotation } from "@/lib/annotations";

interface AnnotationListProps {
  reviewId: string;
  annotations: Annotation[];
  activeAnnotationId: string | null;
  hoveredAnnotationId: string | null;
  onAnnotationsChanged: () => void;
  onHighlightClick: (pageNumber: number) => void;
  onAnnotationHover: (annotationId: string | null) => void;
}

export default function AnnotationList({
  reviewId,
  annotations,
  activeAnnotationId,
  hoveredAnnotationId,
  onAnnotationsChanged,
  onHighlightClick,
  onAnnotationHover,
}: AnnotationListProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeAnnotationId) {
      setTimeout(() => {
        activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    }
  }, [activeAnnotationId]);

  if (annotations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4 px-2">
        <div className="size-11 rounded-md border border-border bg-muted/40 flex items-center justify-center">
          <StickyNote className="text-muted-foreground" size={20} strokeWidth={1.75} />
        </div>
        <div className="space-y-2 max-w-[260px]">
          <p className="text-sm font-semibold tracking-tight text-foreground">
            No notes yet
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Select text in the PDF and click &ldquo;Add note&rdquo; to annotate
            the paper.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-3 py-3 space-y-2">
        {annotations.map((ann) => (
          <AnnotationCard
            key={ann.id}
            ref={ann.id === activeAnnotationId ? activeRef : undefined}
            annotation={ann}
            reviewId={reviewId}
            isActive={ann.id === activeAnnotationId}
            isHovered={ann.id === hoveredAnnotationId}
            onMouseEnter={() => onAnnotationHover(ann.id)}
            onMouseLeave={() => onAnnotationHover(null)}
            onPageClick={() => onHighlightClick(ann.pageNumber)}
            onDelete={() => {
              deleteAnnotation(reviewId, ann.id);
              onAnnotationsChanged();
            }}
            onUpdate={onAnnotationsChanged}
          />
        ))}
      </div>
    </div>
  );
}

interface AnnotationCardProps {
  annotation: Annotation;
  reviewId: string;
  isActive: boolean;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onPageClick: () => void;
  onDelete: () => void;
  onUpdate: () => void;
  ref?: React.Ref<HTMLDivElement>;
}

function AnnotationCard({
  ref,
  annotation,
  reviewId,
  isActive,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onPageClick,
  onDelete,
  onUpdate,
}: AnnotationCardProps) {
  const [note, setNote] = useState(annotation.note);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    setNote(annotation.note);
  }, [annotation.note]);

  const saveNote = useCallback(
    (value: string) => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      noteTimerRef.current = setTimeout(() => {
        updateAnnotation(reviewId, annotation.id, { note: value });
        onUpdate();
      }, 400);
    },
    [reviewId, annotation.id, onUpdate],
  );

  const handleNoteChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNote(e.target.value);
    saveNote(e.target.value);
  };

  return (
    <div
      ref={ref}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "rounded-lg border bg-card transition-all duration-150",
        isActive
          ? "border-primary/40 ring-1 ring-primary/15"
          : isHovered
            ? "border-primary/25"
            : "border-border",
      )}
    >
      <div className="px-3 py-2.5 flex items-start gap-2">
        <div
          className="w-0.5 shrink-0 self-stretch rounded-full transition-colors duration-150"
          style={{
            backgroundColor: isActive || isHovered
              ? "color-mix(in srgb, var(--primary) 60%, transparent)"
              : "color-mix(in srgb, var(--primary) 20%, transparent)",
          }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed italic">
            &ldquo;{annotation.highlightText}&rdquo;
          </p>
          {annotation.note && !isActive && (
            <p className="text-sm text-foreground mt-1 line-clamp-2 leading-relaxed">
              {annotation.note}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPageClick();
            }}
            className="text-[10px] font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5 hover:bg-accent transition-colors"
          >
            p.{annotation.pageNumber}
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 text-muted-foreground/50 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete note"
          >
            <Trash2 size={10} />
          </Button>
        </div>
      </div>

      {isActive && (
        <div className="border-t border-border px-3 py-2">
          <textarea
            value={note}
            onChange={handleNoteChange}
            placeholder="Write a note…"
            rows={2}
            autoFocus
            className="w-full text-sm bg-transparent resize-none focus:outline-none text-foreground placeholder:text-muted-foreground/50 leading-relaxed"
          />
        </div>
      )}
    </div>
  );
}
