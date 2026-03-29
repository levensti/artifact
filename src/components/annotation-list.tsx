"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, StickyNote, Trash2 } from "lucide-react";
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
  /** Narrow sidebar (e.g. beside PDF) uses tighter empty state */
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
        activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    }
  }, [activeAnnotationId]);

  if (annotations.length === 0) {
    const compact = density === "rail";
    return (
      <div
        className={cn(
          "flex flex-1 min-h-0 flex-col items-center justify-center text-center",
          compact ? "gap-3 px-2 py-8" : "gap-4 px-2 py-24",
        )}
      >
        <div
          className={cn(
            "rounded-md border border-border bg-muted/40 flex items-center justify-center",
            compact ? "size-9" : "size-11",
          )}
        >
          <StickyNote
            className="text-muted-foreground"
            size={compact ? 18 : 20}
            strokeWidth={1.75}
          />
        </div>
        <div className={cn("space-y-1.5", compact ? "max-w-[200px]" : "max-w-[260px] space-y-2")}>
          <p className="text-sm font-semibold tracking-tight text-foreground">
            No comments yet
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground/80">Add comment</span> for a note, or{" "}
            <span className="font-medium text-foreground/80">Ask AI</span> for a threaded Q&amp;A on
            the selection.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
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
  /** Focus this thread (e.g. Google Docs–style sidebar) */
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

  const askAiPreview = useMemo(() => {
    if (!isAskAi) return "";
    if (annotation.thread.length === 0) {
      return "No messages yet — ask in the assistant panel.";
    }
    const last = annotation.thread[annotation.thread.length - 1];
    const prefix = last.role === "user" ? "You · " : "AI · ";
    const raw =
      last.content.trim() ||
      (last.blocks?.length ? "Learning map attached" : "");
    return prefix + raw.slice(0, 130) + (raw.length > 130 ? "…" : "");
  }, [isAskAi, annotation.thread]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing prop to local editable state
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
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onActivate}
      onKeyDown={
        onActivate
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate();
              }
            }
          : undefined
      }
      className={cn(
        "overflow-hidden rounded-lg border bg-card transition-all duration-150",
        onActivate && "cursor-pointer",
        isActive
          ? isAskAi
            ? "border-sky-500/40 ring-1 ring-sky-500/15"
            : "border-primary/40 ring-1 ring-primary/15"
          : isHovered
            ? isAskAi
              ? "border-sky-500/30"
              : "border-primary/25"
            : "border-border",
      )}
    >
      <div className="flex items-start gap-2.5 px-3 pt-2.5 pb-2.5">
        <div
          className="mt-0.5 w-0.5 min-h-9 shrink-0 self-stretch rounded-full transition-colors duration-150"
          style={{
            backgroundColor: isAskAi
              ? isActive || isHovered
                ? "color-mix(in srgb, rgb(14 165 233) 55%, transparent)"
                : "color-mix(in srgb, rgb(14 165 233) 22%, transparent)"
              : isActive || isHovered
                ? "color-mix(in srgb, var(--primary) 60%, transparent)"
                : "color-mix(in srgb, var(--primary) 20%, transparent)",
          }}
        />
        <div className="min-w-0 flex-1 pt-px">
          <div className="flex flex-wrap items-center gap-1.5">
            {isAskAi && (
              <span className="inline-flex items-center gap-0.5 rounded bg-sky-500/12 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200">
                <Sparkles className="size-2.5" strokeWidth={2} />
                Ask AI
              </span>
            )}
          </div>
          <p className="text-xs italic leading-snug text-muted-foreground line-clamp-3">
            &ldquo;{annotation.highlightText}&rdquo;
          </p>
          {isAskAi ? (
            <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
              {askAiPreview}
            </p>
          ) : (
            annotation.note &&
            !isActive && (
              <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-foreground">
                {annotation.note}
              </p>
            )
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-px">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPageClick();
            }}
            className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground transition-colors hover:bg-accent"
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
            title={isAskAi ? "Delete thread" : "Delete comment"}
          >
            <Trash2 size={10} />
          </Button>
        </div>
      </div>

      {isActive && !isAskAi && (
        <>
          <div className="h-px w-full bg-border" aria-hidden />
          <div className="px-3 pb-2.5 pt-2" onClick={(e) => e.stopPropagation()}>
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
      {isActive && isAskAi && (
        <>
          <div className="h-px w-full bg-border" aria-hidden />
          <p className="px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            Conversation is in the assistant panel →
          </p>
        </>
      )}
    </div>
  );
}
