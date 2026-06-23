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
import RightPanel, { type RightPanelTab } from "@/components/right-panel";
import { CitationContextProvider } from "@/components/citation-context";
import NoteHoverCard, { type HoverAnchor } from "@/components/note-hover-card";
import SelectionPopover from "@/components/selection-popover";
import { hydrateClientStore } from "@/lib/client-data";
import { loadPdfBlob } from "@/lib/client/pdf-blobs";
import { getReview, updateReviewTitle } from "@/lib/reviews";
import { REVIEWS_UPDATED_EVENT } from "@/lib/storage-events";
import type { Annotation } from "@/lib/annotations";
import {
  getAnnotations,
  addAnnotation,
  getAnnotation,
  deleteAnnotation,
} from "@/lib/annotations";
import { arxivPdfUrl, BREAKPOINTS } from "@/lib/utils";

const ASSISTANT_COLLAPSED_KEY = "artifact-assistant-panel-collapsed";
const ASSISTANT_WIDTH_KEY = "artifact-assistant-panel-width";

import { hasUsableProvider } from "@/lib/keys";
import type { TextSelectionInfo } from "@/components/pdf-viewer";

/**
 * Build the PDF URL for a review. Remote arXiv PDFs still proxy through
 * /api/pdf. Locally-uploaded PDFs live as blobs in IndexedDB — we resolve
 * them to an object URL asynchronously from the component.
 */
function remotePdfUrlForReview(
  review: import("@/lib/reviews").PaperReview,
): string | null {
  if (review.sourceUrl) return null;
  if (review.pdfPath) return null; // handled via loadPdfBlob
  if (review.arxivId) {
    return `/api/pdf?url=${encodeURIComponent(arxivPdfUrl(review.arxivId))}`;
  }
  return null;
}

/**
 * True when the review's title is one of the create-time fallbacks (used when
 * we couldn't get a real title at creation): `arXiv:<id>`, the local PDF
 * filename, "Local PDF", the web URL, or the web hostname. We use this to
 * decide whether to overwrite with the LLM-derived title once the parse
 * completes — never clobbering a user-meaningful title.
 */
function isPlaceholderReviewTitle(
  review: import("@/lib/reviews").PaperReview,
): boolean {
  const t = review.title.trim();
  if (!t) return true;
  if (review.arxivId && t === `arXiv:${review.arxivId}`) return true;
  if (review.pdfPath) {
    if (t === "Local PDF") return true;
    const filename =
      review.pdfPath.split("/").pop()?.replace(/\.pdf$/i, "") ?? "";
    if (filename && t === filename) return true;
  }
  if (review.sourceUrl) {
    if (t === review.sourceUrl) return true;
    try {
      if (t === new URL(review.sourceUrl).hostname) return true;
    } catch {
      /* ignore — non-URL source falls through */
    }
  }
  return false;
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
  const [blobPdfUrl, setBlobPdfUrl] = useState<string | null>(null);

  // Local PDFs live in IndexedDB — read the blob and hand the viewer an
  // object URL; revoke it on unmount so the browser can free the blob.
  // Remote/arxiv PDFs are derived synchronously via useMemo below.
  const localPdfPath = review?.sourceUrl ? null : review?.pdfPath ?? null;
  useEffect(() => {
    if (!localPdfPath) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      const blob = await loadPdfBlob(localPdfPath);
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setBlobPdfUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setBlobPdfUrl(null);
    };
  }, [localPdfPath]);

  const pdfUrl = useMemo(() => {
    if (!review || review.sourceUrl) return null;
    if (review.pdfPath) return blobPdfUrl;
    return remotePdfUrlForReview(review);
  }, [review, blobPdfUrl]);

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
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 440;
    try {
      const saved = window.localStorage.getItem(ASSISTANT_WIDTH_KEY);
      if (saved) {
        const parsed = Number.parseInt(saved, 10);
        if (Number.isFinite(parsed) && parsed >= 320 && parsed <= 980) {
          return parsed;
        }
      }
    } catch {
      /* ignore */
    }
    return window.innerWidth < 1280 ? 360 : 440;
  });
  const [isDragging, setIsDragging] = useState(false);
  const [narrowViewport, setNarrowViewport] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 1280,
  );
  const [assistantOpen, setAssistantOpen] = useState(false);
  /** Which tab the assistant panel shows. Lifted so creating/selecting a note
   *  can switch to the Notes tab, and "Dive deeper" can switch to chat. */
  const [assistantTab, setAssistantTab] = useState<RightPanelTab>("chat");
  const [assistantCollapsed, setAssistantCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(ASSISTANT_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const toggleAssistantCollapsed = useCallback(() => {
    setAssistantCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ASSISTANT_COLLAPSED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const assistantOverlayRef = useRef<HTMLDivElement>(null);

  // Auto-collapse side panels on narrow viewports
  useEffect(() => {
    const mq = window.matchMedia(BREAKPOINTS.COMPACT);
    const handler = (e: MediaQueryListEvent) => {
      setNarrowViewport(e.matches);
      if (e.matches) {
        setAssistantOpen(false);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Close overlay panel when clicking outside
  useEffect(() => {
    if (!narrowViewport) return;
    const handler = (e: MouseEvent) => {
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
  }, [narrowViewport, assistantOpen]);

  const [modelReady, setModelReady] = useState(false);
  /** Passage threads (Dive deeper) / selection: which annotation thread is open in chat */
  const [chatThreadAnnotationId, setChatThreadAnnotationId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!clientReady) return;
    void hydrateClientStore().then(() => {
      setModelReady(hasUsableProvider());
    });
  }, [clientReady]);

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
  /** Viewport geometry of the highlight the hover note points at. */
  const [cardAnchor, setCardAnchor] = useState<{
    id: string;
    anchor: HoverAnchor;
  } | null>(null);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Emitted by the viewers as the cursor moves over / off a highlight. A short
  // close delay bridges the gap between the highlight and the card so moving
  // onto the card (which cancels the timer) doesn't dismiss it.
  const handleViewerHover = useCallback(
    (id: string | null, anchor: HoverAnchor | null) => {
      if (hoverCloseTimer.current) {
        clearTimeout(hoverCloseTimer.current);
        hoverCloseTimer.current = null;
      }
      if (id && anchor) {
        setHoveredAnnotationId(id);
        setCardAnchor({ id, anchor });
      } else {
        hoverCloseTimer.current = setTimeout(
          () => setHoveredAnnotationId(null),
          140,
        );
      }
    },
    [],
  );

  // A scroll anywhere desyncs the cached anchor from the highlight, so dismiss
  // a (non-pinned) hover card on scroll. Pinned editing cards stay put.
  useEffect(() => {
    const onScroll = () => {
      if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
      setHoveredAnnotationId(null);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);

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

  // When the parse pipeline resolves an authoritative title from the paper
  // contents, replace the create-time placeholder (e.g. `arXiv:<id>` when
  // the metadata fetch failed). Skip if the user already has a real title.
  const handleResolvedTitle = useCallback(
    (resolved: string) => {
      if (!review) return;
      if (resolved === review.title) return;
      if (!isPlaceholderReviewTitle(review)) return;
      void updateReviewTitle(review.id, resolved);
    },
    [review],
  );

  const handleTextSelected = useCallback((info: TextSelectionInfo) => {
    setSelectionInfo(info);
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
    // Reveal the assistant (Dive deeper) so the user lands on the thread they
    // just started. On narrow viewports it lives behind an overlay; on wide
    // viewports it has a collapsed strip mode.
    setAssistantTab("chat");
    if (narrowViewport) {
      setAssistantOpen(true);
    } else if (assistantCollapsed) {
      toggleAssistantCollapsed();
    }
    setSelectionInfo(null);
    window.getSelection()?.removeAllRanges();
  }, [
    selectionInfo,
    review,
    refreshAnnotations,
    narrowViewport,
    assistantCollapsed,
    toggleAssistantCollapsed,
  ]);

  const handleAnnotateSelection = useCallback(() => {
    if (selectionInfo && review) {
      // Seed the hover card anchored to the selection so the new note opens
      // inline for immediate editing — no rail required.
      const r = selectionInfo.rect;
      void addAnnotation(review.id, {
        pageNumber: selectionInfo.pageNumber,
        highlightText: selectionInfo.text,
        anchorRects: selectionInfo.anchorRects,
        note: "",
        thread: [],
        kind: "comment",
      }).then((ann) => {
        refreshAnnotations();
        setCardAnchor({
          id: ann.id,
          anchor: {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            colLeft: r.left,
            colRight: r.right,
          },
        });
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
        if (a?.kind === "ask_ai") {
          setChatThreadAnnotationId(id);
          setAssistantTab("chat");
        } else {
          setChatThreadAnnotationId(null);
        }
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
        }
      });
      setHoveredAnnotationId(annotationId);
    },
    [review],
  );


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

    let latestWidth: number | null = null;
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      const minWidth = 320;
      const clamped = Math.max(minWidth, Math.min(980, newWidth));
      latestWidth = clamped;
      setPanelWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (latestWidth != null) {
        try {
          localStorage.setItem(ASSISTANT_WIDTH_KEY, String(latestWidth));
        } catch {
          /* ignore */
        }
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);


  // The hover card shows for whichever highlight is hovered, or — when pinned
  // for editing — the active one, provided we still hold its anchor geometry.
  const hoverCardId = hoveredAnnotationId ?? activeAnnotationId;
  const hoverCardAnn =
    cardAnchor && hoverCardId === cardAnchor.id
      ? annotations.find((a) => a.id === cardAnchor.id) ?? null
      : null;
  const hoverCardPinned =
    !!hoverCardAnn && activeAnnotationId === hoverCardAnn.id;

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
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--reader-mat)" style={{ boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.04), inset 0 0 4px rgba(0,0,0,0.02)' }}>
            {review.sourceUrl ? (
              <WebViewer
                sourceUrl={review.sourceUrl}
                onTextExtracted={setPaperText}
                onTextSelected={handleTextSelected}
                onSelectionCleared={handleSelectionCleared}
                annotations={annotations}
                activeAnnotationId={activeAnnotationId}
                hoveredAnnotationId={hoveredAnnotationId}
                onAnnotationClick={handleAnnotationClick}
                onAnnotationHover={handleViewerHover}
              />
            ) : pdfUrl ? (
              <PdfViewer
                pdfUrl={pdfUrl}
                onTextExtracted={setPaperText}
                onTextSelected={handleTextSelected}
                onSelectionCleared={handleSelectionCleared}
                annotations={annotations}
                activeAnnotationId={activeAnnotationId}
                hoveredAnnotationId={hoveredAnnotationId}
                onAnnotationClick={handleAnnotationClick}
                onAnnotationHover={handleViewerHover}
              />
            ) : (
              <div className="flex h-full min-h-[200px] items-center justify-center gap-2 bg-(--reader-mat) text-muted-foreground text-sm">
                <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
                Loading PDF…
              </div>
            )}
          </div>
        </div>

        {/* Inline drag handle + right panel — only when viewport is wide */}
        {!narrowViewport && (
          <>
            {!assistantCollapsed && (
              <div
                onMouseDown={handleMouseDown}
                className={`group/drag relative w-[5px] cursor-col-resize flex items-center justify-center shrink-0 transition-colors duration-150 ${isDragging ? "bg-primary/25" : "bg-transparent hover:bg-muted-foreground/12"}`}
              >
                <div className="absolute inset-y-0 -left-1 -right-1" />
                <div className={`flex items-center justify-center rounded-full bg-card border border-border shadow-sm transition-opacity duration-150 size-6 ${isDragging ? "opacity-100" : "opacity-0 group-hover/drag:opacity-100"}`}>
                  <GripVertical size={10} className="text-muted-foreground/70" />
                </div>
              </div>
            )}

            <div
              className={`flex min-h-0 shrink-0 flex-col overflow-hidden bg-background ${assistantCollapsed ? "" : "border-l border-border/80"}`}
              style={assistantCollapsed ? undefined : { width: `${panelWidth}px` }}
            >
              <CitationContextProvider
                paperText={paperText}
                modelReady={modelReady}
                onResolvedTitle={handleResolvedTitle}
                paperLoading={!paperText}
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
                  modelReady={modelReady}
                  sourceUrl={review.sourceUrl}
                  collapsed={assistantCollapsed}
                  onToggleCollapsed={toggleAssistantCollapsed}
                  activeTab={assistantTab}
                  onTabChange={setAssistantTab}
                  activeAnnotationId={activeAnnotationId}
                  hoveredAnnotationId={hoveredAnnotationId}
                  onHighlightClick={handleHighlightClick}
                  onAnnotationHover={setHoveredAnnotationId}
                  onAnnotationSelect={handleAnnotationSelect}
                  onAnnotationDeactivate={() => setActiveAnnotationId(null)}
                />
              </CitationContextProvider>
            </div>
          </>
        )}

        {/* Toggle buttons — only when viewport is narrow. Both open the same
            panel; Notes just lands on the Notes tab. */}
        {narrowViewport && (
          <div className="absolute z-30 flex flex-col gap-2 bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-[max(1rem,env(safe-area-inset-right,0px))]">
            <button
              onClick={() => { setAssistantTab("notes"); setAssistantOpen(true); }}
              className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium shadow-lg border transition-colors ${assistantOpen && assistantTab === "notes" ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted"}`}
              title="Notes"
            >
              <StickyNote size={16} />
              <span className="hidden sm:inline">Notes</span>
              {annotations.length > 0 && (
                <span className={`text-xs tabular-nums rounded-full px-1.5 py-0.5 ${assistantOpen && assistantTab === "notes" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {annotations.length}
                </span>
              )}
            </button>
            <button
              onClick={() => { setAssistantTab("chat"); setAssistantOpen(true); }}
              className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium shadow-lg border transition-colors ${assistantOpen && assistantTab === "chat" ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted"}`}
              title="Assistant"
            >
              <MessageSquare size={16} />
              <span className="hidden sm:inline">Assistant</span>
            </button>
          </div>
        )}

        {/* Overlay backdrop */}
        {narrowViewport && assistantOpen && (
          <div
            className="absolute inset-0 z-30 bg-black/20"
            onClick={() => setAssistantOpen(false)}
          />
        )}

        {/* Overlay assistant panel (with Notes tab) */}
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
            <CitationContextProvider
              paperText={paperText}
              modelReady={modelReady}
              onResolvedTitle={handleResolvedTitle}
              paperLoading={!paperText}
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
                modelReady={modelReady}
                sourceUrl={review.sourceUrl}
                activeTab={assistantTab}
                onTabChange={setAssistantTab}
                activeAnnotationId={activeAnnotationId}
                hoveredAnnotationId={hoveredAnnotationId}
                onHighlightClick={handleHighlightClick}
                onAnnotationHover={setHoveredAnnotationId}
                onAnnotationSelect={handleAnnotationSelect}
                onAnnotationDeactivate={() => setActiveAnnotationId(null)}
              />
            </CitationContextProvider>
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

      {/* Inline note that surfaces on highlight hover / pins for editing. */}
      {hoverCardAnn && cardAnchor && (
        <NoteHoverCard
          key={hoverCardAnn.id}
          annotation={hoverCardAnn}
          reviewId={review.id}
          anchor={cardAnchor.anchor}
          pinned={hoverCardPinned}
          onChanged={refreshAnnotations}
          onDelete={() => {
            void deleteAnnotation(review.id, hoverCardAnn.id).then(() => {
              refreshAnnotations();
              setActiveAnnotationId(null);
              setHoveredAnnotationId(null);
              setCardAnchor(null);
            });
          }}
          onRequestPin={() => {
            setActiveAnnotationId(hoverCardAnn.id);
            setChatThreadAnnotationId(null);
          }}
          onClose={() => {
            setActiveAnnotationId(null);
            setHoveredAnnotationId(null);
          }}
          onOpenThread={() => {
            setChatThreadAnnotationId(hoverCardAnn.id);
            setActiveAnnotationId(hoverCardAnn.id);
            setAssistantTab("chat");
            if (narrowViewport) setAssistantOpen(true);
            else if (assistantCollapsed) toggleAssistantCollapsed();
          }}
          onPointerEnter={() => {
            if (hoverCloseTimer.current) {
              clearTimeout(hoverCloseTimer.current);
              hoverCloseTimer.current = null;
            }
          }}
          onPointerLeave={() => {
            if (!hoverCardPinned) setHoveredAnnotationId(null);
          }}
        />
      )}

    </DashboardLayout>
  );
}
