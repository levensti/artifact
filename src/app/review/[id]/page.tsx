"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { GripVertical, Loader2 } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import RightPanel from "@/components/right-panel";
import type { RightTab } from "@/components/right-panel";
import SelectionPopover from "@/components/selection-popover";
import NoteTooltip from "@/components/note-tooltip";
import { hydrateClientStore } from "@/lib/client-data";
import { getReview } from "@/lib/reviews";
import { REVIEWS_UPDATED_EVENT } from "@/lib/storage-events";
import type { Annotation } from "@/lib/annotations";
import { getAnnotations, addAnnotation } from "@/lib/annotations";
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

  const [review, setReview] = useState<
    import("@/lib/reviews").PaperReview | undefined
  >(undefined);
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    if (!clientReady) return;
    startTransition(() => setDataReady(false));
    let cancelled = false;
    void hydrateClientStore().then(() => {
      if (cancelled) return;
      setReview(getReview(params.id));
      setDataReady(true);
    });
    const onReviews = () => setReview(getReview(params.id));
    window.addEventListener(REVIEWS_UPDATED_EVENT, onReviews);
    return () => {
      cancelled = true;
      window.removeEventListener(REVIEWS_UPDATED_EVENT, onReviews);
    };
  }, [clientReady, params.id]);

  const [paperText, setPaperText] = useState("");
  const [selectionInfo, setSelectionInfo] = useState<TextSelectionInfo | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(440);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("assistant");

  useEffect(() => {
    if (!clientReady) return;
    void hydrateClientStore().then(() => {
      const saved = getSavedSelectedModel();
      if (saved) setSelectedModel(saved);
    });
  }, [clientReady]);

  // Wrap setter to also persist the choice
  const handleModelChange = useCallback((model: Model | null) => {
    setSelectedModel(model);
    void saveSelectedModel(model);
  }, []);

  const [annotationVersion, setAnnotationVersion] = useState(0);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const refreshAnnotations = useCallback(
    () => setAnnotationVersion((v) => v + 1),
    [],
  );

  useEffect(() => {
    if (!review) return;
    let cancelled = false;
    void getAnnotations(review.id).then((rows) => {
      if (!cancelled) setAnnotations(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [review, annotationVersion]);
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
    if (!clientReady || !dataReady) return;
    if (!getReview(params.id)) {
      router.push("/");
    }
  }, [clientReady, dataReady, params.id, router]);

  const handleTextSelected = useCallback((info: TextSelectionInfo) => {
    setSelectionInfo(info);
    setTooltip(null);
  }, []);

  const handleSelectionCleared = useCallback(() => {
    setSelectionInfo(null);
  }, []);

  const handleAskAboutSelection = useCallback(() => {
    if (selectionInfo) {
      setPendingSelection(selectionInfo.text);
      setSelectionInfo(null);
      setRightTab("assistant");
      window.getSelection()?.removeAllRanges();
    }
  }, [selectionInfo]);

  const handleAnnotateSelection = useCallback(() => {
    if (selectionInfo && review) {
      void addAnnotation(review.id, {
        pageNumber: selectionInfo.pageNumber,
        highlightText: selectionInfo.text,
        anchorRects: selectionInfo.anchorRects,
        note: "",
        thread: [],
      }).then((ann) => {
        refreshAnnotations();
        setActiveAnnotationId(ann.id);
      });
      setRightTab("notes");
      setSelectionInfo(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [selectionInfo, review, refreshAnnotations]);

  const handleAnnotationClick = useCallback(
    (annotationId: string, info: { clickY: number; highlightRight: number; pageRight: number }) => {
      setTooltip({ annotationId, x: info.highlightRight, y: info.clickY });
      setHoveredAnnotationId(annotationId);
    },
    [],
  );

  const handleTooltipOpenInNotes = useCallback(() => {
    if (tooltip) {
      setActiveAnnotationId(tooltip.annotationId);
      setRightTab("notes");
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
      const minWidth = rightTab === "assistant" ? 380 : 340;
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
  }, [rightTab]);

  const tooltipAnnotation = tooltip
    ? annotations.find((a) => a.id === tooltip.annotationId) ?? null
    : null;

  if (!clientReady || !dataReady || !review) {
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
        <div className="flex-1 min-w-0 overflow-hidden bg-[var(--reader-mat)]">
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
            pendingSelection={pendingSelection}
            onSelectionConsumed={() => setPendingSelection(null)}
            annotations={annotations}
            activeAnnotationId={activeAnnotationId}
            hoveredAnnotationId={hoveredAnnotationId}
            onAnnotationsChanged={refreshAnnotations}
            onHighlightClick={handleHighlightClick}
            onAnnotationHover={setHoveredAnnotationId}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            analysisStatus={analysis.status}
            analysisProgress={analysis.progress}
            analysisError={analysis.error}
            canRunAnalysis={analysis.canRun}
            onTriggerAnalysis={analysis.trigger}
            activeTab={rightTab}
            onTabChange={(tab) => {
              setRightTab(tab);
              if (tab === "assistant") {
                setPanelWidth((prev) => Math.max(prev, 420));
              }
            }}
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

      {tooltipAnnotation && tooltip && (
        <NoteTooltip
          annotation={tooltipAnnotation}
          position={{ x: tooltip.x, y: tooltip.y }}
          onClose={() => {
            setTooltip(null);
            setHoveredAnnotationId(null);
          }}
          onOpenInNotes={handleTooltipOpenInNotes}
        />
      )}
    </DashboardLayout>
  );
}
