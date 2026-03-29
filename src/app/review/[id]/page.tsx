"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { GripVertical, Loader2 } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import RightPanel from "@/components/right-panel";
import NotesRail from "@/components/notes-rail";
import SelectionPopover from "@/components/selection-popover";
import NoteTooltip from "@/components/note-tooltip";
import { getReview } from "@/lib/reviews";
import { getAnnotations, addAnnotation, getAnnotation } from "@/lib/annotations";
import { arxivPdfUrl } from "@/lib/utils";
import { useAnalysis } from "@/hooks/use-auto-analysis";
import { getSavedSelectedModel, saveSelectedModel } from "@/lib/keys";
import type { Model } from "@/lib/models";
import type { TextSelectionInfo } from "@/components/pdf-viewer";

const PdfViewer = dynamic(() => import("@/components/pdf-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[200px] items-center justify-center gap-2 bg-[var(--reader-mat)] text-muted-foreground text-sm">
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
      Loading PDF viewer…
    </div>
  ),
});

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setClientReady(true));
  }, []);

  const review = useMemo(() => {
    if (!clientReady) return undefined;
    return getReview(params.id);
  }, [clientReady, params.id]);

  const [paperText, setPaperText] = useState("");
  const [selectionInfo, setSelectionInfo] = useState<TextSelectionInfo | null>(null);
  const [panelWidth, setPanelWidth] = useState(440);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  /** Passage threads (Dive deeper) / selection: which annotation thread is open in chat */
  const [chatThreadAnnotationId, setChatThreadAnnotationId] = useState<string | null>(null);

  // Restore persisted model once client is ready
  useEffect(() => {
    if (!clientReady) return;
    const saved = getSavedSelectedModel();
    if (saved) setSelectedModel(saved);
  }, [clientReady]);

  // Wrap setter to also persist the choice
  const handleModelChange = useCallback((model: Model | null) => {
    setSelectedModel(model);
    saveSelectedModel(model);
  }, []);

  // Annotation state
  const [annotationVersion, setAnnotationVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const annotations = useMemo(() => (review ? getAnnotations(review.id) : []), [review, annotationVersion]);
  const refreshAnnotations = useCallback(() => setAnnotationVersion((v) => v + 1), []);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ annotationId: string; x: number; y: number } | null>(null);

  // Paper analysis (explicitly triggered, not automatic)
  const analysis = useAnalysis({
    reviewId: review?.id ?? "",
    arxivId: review?.arxivId ?? "",
    paperTitle: review?.title ?? "",
    paperContext: paperText,
    selectedModel,
  });

  useEffect(() => {
    if (!clientReady) return;
    if (!getReview(params.id)) {
      router.push("/");
    }
  }, [clientReady, params.id, router]);

  useEffect(() => {
    if (
      chatThreadAnnotationId &&
      !annotations.some((a) => a.id === chatThreadAnnotationId)
    ) {
      setChatThreadAnnotationId(null);
    }
  }, [annotations, chatThreadAnnotationId]);

  const handleTextSelected = useCallback((info: TextSelectionInfo) => {
    setSelectionInfo(info);
    setTooltip(null);
  }, []);

  const handleSelectionCleared = useCallback(() => {
    setSelectionInfo(null);
  }, []);

  const handleAskAboutSelection = useCallback(() => {
    if (!selectionInfo || !review) return;
    const ann = addAnnotation(review.id, {
      pageNumber: selectionInfo.pageNumber,
      highlightText: selectionInfo.text,
      anchorRects: selectionInfo.anchorRects,
      note: "",
      thread: [],
      kind: "ask_ai",
    });
    refreshAnnotations();
    setActiveAnnotationId(ann.id);
    setChatThreadAnnotationId(ann.id);
    setSelectionInfo(null);
    window.getSelection()?.removeAllRanges();
  }, [selectionInfo, review, refreshAnnotations]);

  const handleAnnotateSelection = useCallback(() => {
    if (selectionInfo && review) {
      const ann = addAnnotation(review.id, {
        pageNumber: selectionInfo.pageNumber,
        highlightText: selectionInfo.text,
        anchorRects: selectionInfo.anchorRects,
        note: "",
        thread: [],
        kind: "comment",
      });
      refreshAnnotations();
      setActiveAnnotationId(ann.id);
      setChatThreadAnnotationId(null);
      setSelectionInfo(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [selectionInfo, review, refreshAnnotations]);

  const handleAnnotationSelect = useCallback(
    (id: string) => {
      setActiveAnnotationId(id);
      const a = getAnnotation(review!.id, id);
      if (a?.kind === "ask_ai") setChatThreadAnnotationId(id);
      else setChatThreadAnnotationId(null);
    },
    [review],
  );

  const handleAnnotationClick = useCallback(
    (annotationId: string, info: { clickY: number; highlightRight: number; pageRight: number }) => {
      setActiveAnnotationId(annotationId);
      const a = getAnnotation(review!.id, annotationId);
      if (a?.kind === "ask_ai") {
        setChatThreadAnnotationId(annotationId);
        setTooltip(null);
      } else {
        setTooltip({ annotationId, x: info.highlightRight, y: info.clickY });
      }
      setHoveredAnnotationId(annotationId);
    },
    [review],
  );

  const handleFocusNoteThread = useCallback(() => {
    if (tooltip) {
      setActiveAnnotationId(tooltip.annotationId);
      setTooltip(null);
    }
  }, [tooltip]);

  const handleHighlightClick = useCallback((pageNumber: number) => {
    const container = document.querySelector("[data-pdf-container]");
    if (!container) return;
    const target = container.querySelector(`[data-page-number="${pageNumber}"]`);
    target?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      const minWidth = 380;
      setPanelWidth(Math.max(minWidth, Math.min(980, newWidth)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  const tooltipAnnotation = tooltip
    ? annotations.find((a) => a.id === tooltip.annotationId) ?? null
    : null;

  if (!clientReady || !review) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Loading…
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex h-full overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--reader-mat)]">
            <PdfViewer
              url={arxivPdfUrl(review.arxivId)}
              onTextExtracted={setPaperText}
              onTextSelected={handleTextSelected}
              onSelectionCleared={handleSelectionCleared}
              annotations={annotations}
              activeAnnotationId={tooltip?.annotationId ?? activeAnnotationId}
              hoveredAnnotationId={hoveredAnnotationId}
              onAnnotationClick={handleAnnotationClick}
            />
          </div>

          <NotesRail
            reviewId={review.id}
            annotations={annotations}
            activeAnnotationId={activeAnnotationId}
            hoveredAnnotationId={hoveredAnnotationId}
            onAnnotationsChanged={refreshAnnotations}
            onHighlightClick={handleHighlightClick}
            onAnnotationHover={setHoveredAnnotationId}
            onAnnotationSelect={handleAnnotationSelect}
          />
        </div>

        <div
          onMouseDown={handleMouseDown}
          className={`relative w-1 cursor-col-resize flex items-center justify-center shrink-0 transition-colors ${isDragging ? "bg-primary/30" : "bg-border/80 hover:bg-muted-foreground/25"}`}
        >
          <div className="absolute p-0.5 rounded-md bg-card border border-border/90 opacity-0 hover:opacity-100 transition-opacity shadow-sm">
            <GripVertical size={10} className="text-muted-foreground" />
          </div>
        </div>

        <div
          className="flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-border/80 bg-background"
          style={{ width: `${panelWidth}px` }}
        >
          <RightPanel
            reviewId={review.id}
            arxivId={review.arxivId}
            paperTitle={review.title}
            paperContext={paperText}
            annotations={annotations}
            chatThreadAnnotationId={chatThreadAnnotationId}
            onChatThreadChange={setChatThreadAnnotationId}
            onAnnotationsPersist={refreshAnnotations}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            analysisStatus={analysis.status}
            analysisProgress={analysis.progress}
            analysisError={analysis.error}
            canRunAnalysis={analysis.canRun}
            onTriggerAnalysis={analysis.trigger}
          />
        </div>
      </div>

      {selectionInfo && (
        <SelectionPopover
          rect={selectionInfo.rect}
          onAsk={handleAskAboutSelection}
          onAnnotate={handleAnnotateSelection}
        />
      )}

      {tooltipAnnotation &&
        tooltip &&
        tooltipAnnotation.kind === "comment" && (
        <NoteTooltip
          annotation={tooltipAnnotation}
          position={{ x: tooltip.x, y: tooltip.y }}
          onClose={() => {
            setTooltip(null);
            setHoveredAnnotationId(null);
          }}
          onFocusThread={handleFocusNoteThread}
        />
      )}
    </DashboardLayout>
  );
}
