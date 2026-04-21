"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type Annotation,
  updateAnnotation,
  deleteAnnotation,
} from "@/lib/annotations";

interface AnnotationListProps {
  reviewId: string;
  annotations: Annotation[];
  activeAnnotationId: string | null;
  hoveredAnnotationId: string | null;
  onAnnotationsChanged: () => void;
  onHighlightClick: (annotationId: string, pageNumber: number) => void;
  onAnnotationHover: (annotationId: string | null) => void;
  /** Narrow notes rail (beside PDF) uses tighter empty state */
  density?: "default" | "rail";
  onAnnotationSelect?: (id: string) => void;
}

export default function AnnotationList({
  reviewId,
  annotations,
  activeAnnotationId,
  hoveredAnnotationId,
  onAnnotationsChanged,
  onHighlightClick,
  onAnnotationHover,
  density = "default",
  onAnnotationSelect,
}: AnnotationListProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeAnnotationId) {
      setTimeout(() => {
        activeRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 50);
    }
  }, [activeAnnotationId]);

  if (annotations.length === 0) {
    const compact = density === "rail";
    return (
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col items-center justify-center text-center font-sans antialiased",
          compact ? "px-5 pb-4 pt-5" : "px-5 pb-4 pt-6",
        )}
      >
        <div className="flex flex-col items-center gap-4 max-w-[200px]">
          {/* Visual flow: select → action */}
          <div className="flex items-center gap-2 text-muted-foreground/40">
            <div className="flex h-7 items-center rounded bg-primary/8 px-2 text-[10px] font-medium text-primary/50 border border-primary/10">
              selected text
            </div>
            <svg width="16" height="10" viewBox="0 0 16 10" fill="none" className="shrink-0 text-muted-foreground/30">
              <path d="M0 5h12M10 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="flex h-7 items-center rounded-full bg-foreground/8 px-2 text-[10px] font-medium text-muted-foreground/50 border border-border/60">
              note
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-[13px] font-semibold tracking-tight text-foreground">
              No annotations yet
            </p>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground/60">
              Select any passage in the paper to add a note or dive deeper with your assistant.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
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
            onPageClick={() => onHighlightClick(ann.id, ann.pageNumber)}
            onDelete={() => {
              void deleteAnnotation(reviewId, ann.id).then(() =>
                onAnnotationsChanged(),
              );
            }}
            onUpdate={onAnnotationsChanged}
            onActivate={
              onAnnotationSelect ? () => onAnnotationSelect(ann.id) : undefined
            }
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
  /** Focus this card in the notes rail */
  onActivate?: () => void;
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
  onActivate,
}: AnnotationCardProps) {
  const isAskAi = annotation.kind === "ask_ai";
  const [note, setNote] = useState(annotation.note);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing prop to local editable state
    setNote(annotation.note);
  }, [annotation.note]);

  const saveNote = useCallback(
    (value: string) => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      noteTimerRef.current = setTimeout(() => {
        void updateAnnotation(reviewId, annotation.id, { note: value }).then(
          () => onUpdate(),
        );
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
      role="button"
      tabIndex={0}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={() => {
        onPageClick();
        onActivate?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPageClick();
          onActivate?.();
        }
      }}
      className={cn(
        "overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:shadow-md hover:shadow-primary/5",
        "cursor-pointer",
        isActive
          ? isAskAi
            ? "border-sky-500/35 ring-1 ring-sky-500/10"
            : "border-primary/40 ring-1 ring-primary/15"
          : isHovered
            ? isAskAi
              ? "border-sky-500/28"
              : "border-primary/25"
            : "border-border",
      )}
    >
      {isAskAi ? (
        <>
          <div className="flex items-start justify-between gap-2 px-3.5 pt-3.5">
            <span className="inline-flex max-w-[min(100%,11rem)] items-center gap-1 rounded-lg bg-gradient-to-r from-sky-500/15 to-sky-400/8 px-2 py-1 text-[10px] font-semibold leading-tight tracking-tight text-sky-800 shadow-sm shadow-sky-500/10 dark:text-sky-100">
              <Sparkles className="size-3 shrink-0" strokeWidth={2} />
              Dive deeper
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground/60 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Delete thread"
            >
              <Trash2 size={12} />
            </Button>
          </div>

          <div className="mx-3.5 mt-3 rounded-xl border border-border/40 bg-gradient-to-br from-muted/20 to-muted/5 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              From the paper
            </p>
            <p className="mt-2 line-clamp-4 text-sm italic leading-relaxed text-foreground/90">
              &ldquo;{annotation.highlightText}&rdquo;
            </p>
          </div>

          <div className="mt-3 border-t border-border/60 px-3.5 pb-3.5 pt-3">
            {annotation.thread.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                No replies yet. Click here and ask in the assistant panel.
              </p>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium tabular-nums text-foreground/85">
                    {annotation.thread.length}
                  </span>{" "}
                  {annotation.thread.length === 1 ? "message" : "messages"} —
                  open in assistant
                </p>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground/70"
                  aria-hidden
                />
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-start gap-2.5 px-3 pt-2.5 pb-2.5">
            <div
              className="mt-0.5 w-[3px] min-h-9 shrink-0 self-stretch rounded-full transition-all duration-200"
              style={{
                backgroundColor:
                  isActive || isHovered
                    ? "color-mix(in srgb, var(--primary) 60%, transparent)"
                    : "color-mix(in srgb, var(--primary) 20%, transparent)",
              }}
            />
            <div className="min-w-0 flex-1 pt-px">
              <p className="text-xs italic leading-normal text-muted-foreground line-clamp-3">
                &ldquo;{annotation.highlightText}&rdquo;
              </p>
              {annotation.note && !isActive && (
                <p className="mt-1.5 line-clamp-2 text-sm leading-normal text-foreground">
                  {annotation.note}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 shrink-0 text-muted-foreground/50 hover:text-destructive pt-px"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Delete note"
            >
              <Trash2 size={10} />
            </Button>
          </div>
        </>
      )}

      {isActive && !isAskAi && (
        <>
          <div className="h-px w-full bg-border" aria-hidden />
          <div
            className="px-3 pb-2.5 pt-2"
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              value={note}
              onChange={handleNoteChange}
              placeholder="Write a note…"
              rows={2}
              autoFocus
              className="w-full resize-none bg-transparent text-sm leading-snug text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
          </div>
        </>
      )}
    </div>
  );
}
