"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { GripVertical, Loader2, MessageSquare, StickyNote, X } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import RightPanel from "@/components/right-panel";
import NotesRail from "@/components/notes-rail";
import SelectionPopover from "@/components/selection-popover";
import NoteTooltip from "@/components/note-tooltip";
import { hydrateClientStore } from "@/lib/client-data";
import { getReview } from "@/lib/reviews";
import { REVIEWS_UPDATED_EVENT } from "@/lib/storage-events";
import type { Annotation } from "@/lib/annotations";
import {
  getAnnotations,
  addAnnotation,
  getAnnotation,
} from "@/lib/annotations";
import { arxivPdfUrl } from "@/lib/utils";

import { getSavedSelectedModel, saveSelectedModel } from "@/lib/keys";
import { useAutoWikiIngest } from "@/hooks/use-auto-wiki-ingest";
import type { Model } from "@/lib/models";
import type { TextSelectionInfo } from "@/components/pdf-viewer";

/** Build the API URL to load the PDF for a given review. Returns null for web reviews. */
function pdfUrlForReview(review: import("@/lib/reviews").PaperReview): string | null {
  if (review.sourceUrl) return null;
  if (review.pdfPath) {
    return `/api/pdf?path=${encodeURIComponent(review.pdfPath)}`;
  }
  return `/api/pdf?url=${encodeURIComponent(arxivPdfUrl(review.arxivId!))}`;
}

const PdfViewer = dynamic(() => import("@/components/pdf-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[200px] items-center justify-center gap-2 bg-(--reader-mat) text-muted-foreground text-sm">
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
      Loading PDF viewer…
    </div>
  ),
});

const WebViewer = dynamic(() => import("@/components/web-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[200px] items-center justify-center gap-2 bg-(--reader-mat) text-muted-foreground text-sm">
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
      Loading page…
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
  const [selectionInfo, setSelectionInfo] = useState<TextSelectionInfo | null>(
    null,
  );
  const [panelWidth, setPanelWidth] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 1280 ? 360 : 440,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [narrowViewport, setNarrowViewport] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 1280,
  );
  const [notesOpen, setNotesOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const notesOverlayRef = useRef<HTMLDivElement>(null);
  const assistantOverlayRef = useRef<HTMLDivElement>(null);

  // Auto-collapse side panels on narrow viewports
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const handler = (e: MediaQueryListEvent) => {
      setNarrowViewport(e.matches);
      if (e.matches) {
        setNotesOpen(false);
        setAssistantOpen(false);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Close overlay panels when clicking outside
  useEffect(() => {
    if (!narrowViewport) return;
    const handler = (e: MouseEvent) => {
      if (
        notesOpen &&
        notesOverlayRef.current &&
        !notesOverlayRef.current.contains(e.target as Node)
      ) {
        setNotesOpen(false);
      }
      if (
        assistantOpen &&
        assistantOverlayRef.current &&
        !assistantOverlayRef.current.contains(e.target as Node)
      ) {
        setAssistantOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [narrowViewport, notesOpen, assistantOpen]);

  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  /** Passage threads (Dive deeper) / selection: which annotation thread is open in chat */
  const [chatThreadAnnotationId, setChatThreadAnnotationId] = useState<
    string | null
  >(null);

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

  // Ambient background: when a paper is opened, silently ingest it into the
  // wiki so the knowledge base compounds without any user action. Runs once
  // per review (guarded inside the hook + server-side `hasWikiSourcesForReview`).
  useAutoWikiIngest({
    reviewId: review?.id ?? "",
    paperTitle: review?.title ?? "",
    arxivId: review?.arxivId ?? null,
    paperText,
    selectedModel,
  });

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
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(
    null,
  );
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(
    null,
  );
  const [tooltip, setTooltip] = useState<{
    annotationId: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!clientReady || !dataReady) return;
    if (!getReview(params.id)) {
      router.push("/");
    }
  }, [clientReady, dataReady, params.id, router]);

  /** Ignore stale thread id if that annotation was removed (no setState in an effect). */
  const effectiveChatThreadAnnotationId = useMemo(() => {
    if (!chatThreadAnnotationId) return null;
    return annotations.some((a) => a.id === chatThreadAnnotationId)
      ? chatThreadAnnotationId
      : null;
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
    void addAnnotation(review.id, {
      pageNumber: selectionInfo.pageNumber,
      highlightText: selectionInfo.text,
      anchorRects: selectionInfo.anchorRects,
      note: "",
      thread: [],
      kind: "ask_ai",
    }).then((ann) => {
      refreshAnnotations();
      setActiveAnnotationId(ann.id);
      setChatThreadAnnotationId(ann.id);
    });
    setSelectionInfo(null);
    window.getSelection()?.removeAllRanges();
  }, [selectionInfo, review, refreshAnnotations]);

  const handleAnnotateSelection = useCallback(() => {
    if (selectionInfo && review) {
      void addAnnotation(review.id, {
        pageNumber: selectionInfo.pageNumber,
        highlightText: selectionInfo.text,
        anchorRects: selectionInfo.anchorRects,
        note: "",
        thread: [],
        kind: "comment",
      }).then((ann) => {
        refreshAnnotations();
        setActiveAnnotationId(ann.id);
        setChatThreadAnnotationId(null);
      });
      setSelectionInfo(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [selectionInfo, review, refreshAnnotations]);

  const handleAnnotationSelect = useCallback(
    (id: string) => {
      setActiveAnnotationId(id);
      if (!review) return;
      void getAnnotation(review.id, id).then((a) => {
        if (a?.kind === "ask_ai") setChatThreadAnnotationId(id);
        else setChatThreadAnnotationId(null);
      });
    },
    [review],
  );

  const handleAnnotationClick = useCallback(
    (
      annotationId: string,
      info: { clickY: number; highlightRight: number; pageRight: number },
    ) => {
      setActiveAnnotationId(annotationId);
      if (!review) return;
      void getAnnotation(review.id, annotationId).then((a) => {
        if (a?.kind === "ask_ai") {
          setChatThreadAnnotationId(annotationId);
          setTooltip(null);
        } else {
          setTooltip({ annotationId, x: info.highlightRight, y: info.clickY });
        }
      });
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

  const handleHighlightClick = useCallback((annotationId: string, pageNumber: number) => {
    // Try PDF container first
    const pdfContainer = document.querySelector("[data-pdf-container]");
    if (pdfContainer) {
      const target = pdfContainer.querySelector(
        `[data-page-number="${pageNumber}"]`,
      );
      target?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    // Fall back to web viewer highlight overlay
    const highlight = document.querySelector(`[data-annotation-id="${annotationId}"]`);
    highlight?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      const minWidth = 320;
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
    ? (annotations.find((a) => a.id === tooltip.annotationId) ?? null)
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
      <div className="relative flex h-full overflow-hidden">
        {/* Main content: paper viewer + inline notes rail (when wide) */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--reader-mat)">
            {review.sourceUrl ? (
              <WebViewer
                sourceUrl={review.sourceUrl}
                onTextExtracted={setPaperText}
                onTextSelected={handleTextSelected}
                onSelectionCleared={handleSelectionCleared}
                annotations={annotations}
                activeAnnotationId={tooltip?.annotationId ?? activeAnnotationId}
                hoveredAnnotationId={hoveredAnnotationId}
                onAnnotationClick={handleAnnotationClick}
              />
            ) : (
              <PdfViewer
                pdfUrl={pdfUrlForReview(review)!}
                onTextExtracted={setPaperText}
                onTextSelected={handleTextSelected}
                onSelectionCleared={handleSelectionCleared}
                annotations={annotations}
                activeAnnotationId={tooltip?.annotationId ?? activeAnnotationId}
                hoveredAnnotationId={hoveredAnnotationId}
                onAnnotationClick={handleAnnotationClick}
              />
            )}
          </div>

          {/* Inline notes rail — only when viewport is wide */}
          {!narrowViewport && (
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
          )}
        </div>

        {/* Inline drag handle + right panel — only when viewport is wide */}
        {!narrowViewport && (
          <>
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
                arxivId={review.arxivId ?? ""}
                paperTitle={review.title}
                paperContext={paperText}
                annotations={annotations}
                chatThreadAnnotationId={effectiveChatThreadAnnotationId}
                onChatThreadChange={setChatThreadAnnotationId}
                onAnnotationsPersist={refreshAnnotations}
                selectedModel={selectedModel}
                onModelChange={handleModelChange}
                sourceUrl={review.sourceUrl}
              />
            </div>
          </>
        )}

        {/* Toggle buttons — only when viewport is narrow */}
        {narrowViewport && (
          <div className="absolute z-30 flex flex-col gap-2 bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-[max(1rem,env(safe-area-inset-right,0px))]">
            <button
              onClick={() => { setNotesOpen((v) => !v); setAssistantOpen(false); }}
              className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium shadow-lg border transition-colors ${notesOpen ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted"}`}
              title="Toggle notes"
            >
              <StickyNote size={16} />
              <span className="hidden sm:inline">Notes</span>
              {annotations.length > 0 && (
                <span className={`text-xs tabular-nums rounded-full px-1.5 py-0.5 ${notesOpen ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {annotations.length}
                </span>
              )}
            </button>
            <button
              onClick={() => { setAssistantOpen((v) => !v); setNotesOpen(false); }}
              className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium shadow-lg border transition-colors ${assistantOpen ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted"}`}
              title="Toggle assistant"
            >
              <MessageSquare size={16} />
              <span className="hidden sm:inline">Assistant</span>
            </button>
          </div>
        )}

        {/* Overlay backdrop */}
        {narrowViewport && (notesOpen || assistantOpen) && (
          <div
            className="absolute inset-0 z-30 bg-black/20"
            onClick={() => { setNotesOpen(false); setAssistantOpen(false); }}
          />
        )}

        {/* Overlay notes rail */}
        {narrowViewport && notesOpen && (
          <div
            ref={notesOverlayRef}
            className="absolute right-0 top-0 bottom-0 z-40 w-[min(320px,85vw)] animate-in slide-in-from-right duration-200 shadow-2xl"
          >
            <button
              onClick={() => setNotesOpen(false)}
              className="absolute top-3 right-3 z-50 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X size={16} />
            </button>
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
        )}

        {/* Overlay assistant panel */}
        {narrowViewport && assistantOpen && (
          <div
            ref={assistantOverlayRef}
            className="absolute right-0 top-0 bottom-0 z-40 flex w-[min(440px,90vw)] flex-col overflow-hidden border-l border-border/80 bg-background animate-in slide-in-from-right duration-200 shadow-2xl"
          >
            <button
              onClick={() => setAssistantOpen(false)}
              className="absolute top-3 right-3 z-50 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X size={16} />
            </button>
            <RightPanel
              reviewId={review.id}
              arxivId={review.arxivId ?? ""}
              paperTitle={review.title}
              paperContext={paperText}
              annotations={annotations}
              chatThreadAnnotationId={effectiveChatThreadAnnotationId}
              onChatThreadChange={setChatThreadAnnotationId}
              onAnnotationsPersist={refreshAnnotations}
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
              sourceUrl={review.sourceUrl}
            />
          </div>
        )}
      </div>

      {selectionInfo && (
        <SelectionPopover
          rect={selectionInfo.rect}
          onAsk={handleAskAboutSelection}
          onAnnotate={handleAnnotateSelection}
        />
      )}

      {tooltipAnnotation && tooltip && tooltipAnnotation.kind === "comment" && (
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
