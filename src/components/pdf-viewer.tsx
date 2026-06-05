"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ChevronUp, ChevronDown, ZoomIn, ZoomOut, Loader2, FileWarning, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Annotation } from "@/lib/annotations";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface TextSelectionInfo {
  text: string;
  rect: DOMRect;
  pageNumber: number;
  anchorRects: { x: number; y: number; w: number; h: number }[];
}

interface PdfViewerProps {
  /** The URL to load the PDF from. Passed directly to react-pdf. */
  pdfUrl: string;
  onTextExtracted: (text: string) => void;
  onTextSelected: (info: TextSelectionInfo) => void;
  onSelectionCleared: () => void;
  annotations?: Annotation[];
  activeAnnotationId?: string | null;
  hoveredAnnotationId?: string | null;
  onAnnotationClick?: (annotationId: string, info: { clickY: number; highlightRight: number; pageRight: number }) => void;
}

const H_PADDING = 16;
const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_DEBOUNCE_MS = 140;

function clientXY(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ("changedTouches" in e && e.changedTouches[0]) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  const m = e as MouseEvent;
  return { x: m.clientX, y: m.clientY };
}

export default function PdfViewer({
  pdfUrl,
  onTextExtracted,
  onTextSelected,
  onSelectionCleared,
  annotations = [],
  activeAnnotationId,
  hoveredAnnotationId,
  onAnnotationClick,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  /**
   * Multiplier on fit-to-width (1 = page width matches column).
   * `liveZoom` updates immediately on click so the UI feels responsive.
   * `committedZoom` is the value pdf.js actually rasterizes at; it lags
   * behind `liveZoom` by `ZOOM_DEBOUNCE_MS` so rapid clicks coalesce into a
   * single re-rasterization.
   */
  const [liveZoom, setLiveZoom] = useState(1);
  const [committedZoom, setCommittedZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setContainerWidth(w > 0 ? w : 0);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fitWidth = Math.max(0, containerWidth - H_PADDING);
  const pageWidth = Math.max(
    120,
    Math.floor(fitWidth * Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, committedZoom))),
  );

  // Trackpad pinch on macOS arrives as a `wheel` event with `ctrlKey`
  // synthesized by the OS; the same path covers actual Ctrl+wheel on a
  // mouse. We intercept it on the scroll container so the browser's
  // native page zoom doesn't fire, and feed `liveZoom` — the same
  // state the +/- buttons drive — so the percent readout stays in sync.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setLiveZoom((z) => {
        // Exponential mapping feels uniform across zoom levels: a given
        // pinch motion produces the same *percent* change whether you're
        // at 60% or 200%. 0.002 tuned so a wheel notch (~100 deltaY) is
        // ~20% — close to the buttons' ZOOM_STEP of 0.2.
        const next = z * Math.exp(-e.deltaY * 0.002);
        const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
        return Math.round(clamped * 100) / 100;
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // Coalesce rapid zoom clicks into one rasterization.
  useEffect(() => {
    if (liveZoom === committedZoom) return;
    const id = window.setTimeout(
      () => setCommittedZoom(liveZoom),
      ZOOM_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(id);
  }, [liveZoom, committedZoom]);

  // Intercept Cmd/Ctrl+F so it toggles the in-paper search bar instead of the
  // browser's native Find (which would also match toolbar/chrome text).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchOpen((open) => {
          if (open) {
            setSearchQuery("");
            setActiveMatchIndex(0);
            setMatchCount(0);
            return false;
          }
          requestAnimationFrame(() => {
            const input = searchInputRef.current;
            if (input) {
              input.focus();
              input.select();
            }
          });
          return true;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // react-pdf renders page text layers asynchronously as each page loads, so
  // we can't compute match count synchronously after a query change. Watch the
  // container for mutations and recount whenever <mark> nodes appear/disappear.
  // When the query is empty, customTextRenderer emits no marks, so the observer
  // naturally drives matchCount to 0 — no synchronous reset needed here.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!searchQuery.trim()) return;
    const update = () => {
      const matches = container.querySelectorAll(".paper-search-match");
      setMatchCount(matches.length);
      setActiveMatchIndex((idx) =>
        matches.length === 0 ? 0 : Math.min(idx, matches.length - 1),
      );
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(container, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [searchQuery]);

  // Apply the active class to the current match and scroll it into view.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const matches = container.querySelectorAll<HTMLElement>(".paper-search-match");
    matches.forEach((m, i) => {
      m.classList.toggle("paper-search-match-active", i === activeMatchIndex);
    });
    const active = matches[activeMatchIndex];
    if (active) active.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchIndex, matchCount]);

  const extractText = useCallback(
    async (pdf: PDFDocumentProxy) => {
      try {
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          if (!pdf || typeof pdf.getPage !== "function") return;
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const strings = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
          pages.push(`[Page ${i}]\n${strings}`);
        }
        onTextExtracted(pages.join("\n\n"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("Cannot read properties of null")) {
          console.error("Failed to extract text:", err);
        }
      }
    },
    [onTextExtracted],
  );

  const onDocumentLoadSuccess = useCallback(
    (result: { numPages: number }) => {
      setNumPages(result.numPages);
      setLoading(false);
      const pdfProxy = result as unknown as PDFDocumentProxy;
      if (typeof pdfProxy.getPage === "function") {
        extractText(pdfProxy);
      }
    },
    [extractText],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handlePointerUp = (e: MouseEvent | TouchEvent) => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (selection && text && text.length > 0 && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        let node: Node | null = range.startContainer;
        let pageEl: Element | null = null;
        while (node) {
          if (node instanceof Element) {
            const pn = node.closest("[data-page-number]");
            if (pn) {
              pageEl = pn;
              break;
            }
          }
          node = node.parentNode;
        }
        const pageNumber = pageEl
          ? parseInt(pageEl.getAttribute("data-page-number") || "1", 10)
          : 1;

        const anchorRects: { x: number; y: number; w: number; h: number }[] = [];
        if (pageEl) {
          const pageRect = pageEl.getBoundingClientRect();
          const rects = range.getClientRects();
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            anchorRects.push({
              x: (r.left - pageRect.left) / pageRect.width,
              y: (r.top - pageRect.top) / pageRect.height,
              w: r.width / pageRect.width,
              h: r.height / pageRect.height,
            });
          }
        }

        onTextSelected({ text, rect, pageNumber, anchorRects });
      } else {
        onSelectionCleared();

        if (onAnnotationClick) {
          const { x: cx, y: cy } = clientXY(e);
          const target = (e.target as Element) || document.elementFromPoint(cx, cy);
          if (!target) return;
          const pageEl = target.closest("[data-page-number]");
          if (pageEl) {
            const pageRect = pageEl.getBoundingClientRect();
            const nx = (cx - pageRect.left) / pageRect.width;
            const ny = (cy - pageRect.top) / pageRect.height;
            const pageNum = parseInt(pageEl.getAttribute("data-page-number") || "0", 10);

            for (const ann of annotations) {
              if (ann.pageNumber !== pageNum) continue;
              for (const r of ann.anchorRects) {
                if (nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h) {
                  onAnnotationClick(ann.id, {
                    clickY: cy,
                    highlightRight: pageRect.left + (r.x + r.w) * pageRect.width,
                    pageRight: pageRect.right,
                  });
                  return;
                }
              }
            }
          }
        }
      }
    };

    container.addEventListener("mouseup", handlePointerUp);
    container.addEventListener("touchend", handlePointerUp, { passive: true });
    return () => {
      container.removeEventListener("mouseup", handlePointerUp);
      container.removeEventListener("touchend", handlePointerUp);
    };
  }, [onTextSelected, onSelectionCleared, annotations, onAnnotationClick]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const pages = container.querySelectorAll("[data-page-number]");
        let closestPage = 1;
        let closestDistance = Infinity;
        const containerTop = container.getBoundingClientRect().top;

        pages.forEach((el) => {
          const distance = Math.abs(el.getBoundingClientRect().top - containerTop);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestPage = parseInt(el.getAttribute("data-page-number") || "1", 10);
          }
        });
        setCurrentPage(closestPage);
      });
    };

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [numPages]);

  const goToPage = (page: number) => {
    const container = containerRef.current;
    if (!container) return;
    const target = container.querySelector(`[data-page-number="${page}"]`);
    target?.scrollIntoView({ behavior: "smooth" });
  };

  const customTextRenderer = useCallback(
    (item: { str: string }) => {
      const escapeHtml = (s: string) =>
        s.replace(/[&<>"']/g, (c) =>
          c === "&" ? "&amp;"
          : c === "<" ? "&lt;"
          : c === ">" ? "&gt;"
          : c === '"' ? "&quot;"
          : "&#39;",
        );
      const safe = escapeHtml(item.str);
      const q = searchQuery.trim();
      if (!q) return safe;
      const safeQuery = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(safeQuery, "gi");
      return safe.replace(re, (m) => `<mark class="paper-search-match">${m}</mark>`);
    },
    [searchQuery],
  );

  const nextMatch = useCallback(
    () => setActiveMatchIndex((i) => (matchCount === 0 ? 0 : (i + 1) % matchCount)),
    [matchCount],
  );
  const prevMatch = useCallback(
    () =>
      setActiveMatchIndex((i) =>
        matchCount === 0 ? 0 : (i - 1 + matchCount) % matchCount,
      ),
    [matchCount],
  );
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveMatchIndex(0);
    setMatchCount(0);
  }, []);

  const zoomOut = () =>
    setLiveZoom((z) =>
      Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100),
    );
  const zoomIn = () =>
    setLiveZoom((z) =>
      Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100),
    );

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="flex h-11 sm:h-14 shrink-0 items-center justify-between border-b border-border/60 bg-background/60 pl-[max(env(safe-area-inset-left),0.75rem)] pr-[max(env(safe-area-inset-right),0.75rem)] sm:pl-[max(env(safe-area-inset-left),1rem)] sm:pr-[max(env(safe-area-inset-right),1rem)] backdrop-blur-md">
        <div className="flex h-7 sm:h-8 items-center gap-0.5 rounded-full bg-muted/60 px-0.5 sm:px-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 sm:size-7"
            onClick={() => currentPage > 1 && goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            title="Previous page"
          >
            <ChevronUp size={14} />
          </Button>
          <span className="min-w-[52px] sm:min-w-[56px] text-center text-[11px] sm:text-xs font-semibold tabular-nums leading-none text-foreground/70">
            {currentPage} / {numPages || "·"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 sm:size-7"
            onClick={() => currentPage < numPages && goToPage(currentPage + 1)}
            disabled={currentPage >= numPages}
            title="Next page"
          >
            <ChevronDown size={14} />
          </Button>
        </div>
        <div className="flex h-7 sm:h-8 items-center gap-0.5 rounded-full bg-muted/60 px-0.5 sm:px-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 sm:size-7"
            onClick={zoomOut}
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </Button>
          <span className="min-w-[36px] sm:min-w-[40px] text-center text-[11px] sm:text-xs font-semibold tabular-nums leading-none text-foreground/70">
            {Math.round(liveZoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 sm:size-7"
            onClick={zoomIn}
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </Button>
        </div>
      </div>

      {searchOpen && (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background/60 px-2 backdrop-blur-md">
          <Search size={14} className="ml-1 text-foreground/50" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => {
              const v = e.target.value;
              setSearchQuery(v);
              setActiveMatchIndex(0);
              if (v.trim() === "") setMatchCount(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) prevMatch();
                else nextMatch();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              }
            }}
            placeholder="Search in paper"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-foreground/40"
          />
          <span className="min-w-[44px] text-right text-[11px] tabular-nums text-foreground/60">
            {searchQuery.trim() === ""
              ? ""
              : matchCount === 0
                ? "0/0"
                : `${activeMatchIndex + 1}/${matchCount}`}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={prevMatch}
            disabled={matchCount === 0}
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={nextMatch}
            disabled={matchCount === 0}
            title="Next match (Enter)"
          >
            <ChevronDown size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={closeSearch}
            title="Close (Esc)"
          >
            <X size={14} />
          </Button>
        </div>
      )}

      <div ref={containerRef} data-pdf-container className="flex-1 overflow-auto min-h-0">
        {loading && !loadError && (
          <div className="flex items-center justify-center h-full min-h-[200px]">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        )}
        {loadError && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
            <FileWarning className="text-destructive" size={28} />
            <p className="text-sm text-muted-foreground">{loadError}</p>
          </div>
        )}
        <Document
          file={pdfUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(err) => {
            console.error("PDF load error:", err);
            setLoading(false);
            setLoadError("Failed to load PDF. Check that the URL or file path is valid.");
          }}
          loading={null}
          // `align-items: safe center` keeps small pages centered but falls
          // back to start-aligned when the page is wider than the column —
          // otherwise the left edge of a zoomed page is clipped beyond the
          // scroll origin. `w-fit min-w-full` makes the Document grow to
          // match its widest page so the parent's overflow-auto can produce
          // a horizontal scrollbar.
          className="flex flex-col gap-2 py-3 sm:py-4 px-2 w-fit min-w-full [align-items:safe_center]"
        >
          {Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1;
            const pageAnnotations = annotations.filter((a) => a.pageNumber === pageNum);
            // Transient CSS scale during the debounce window so the page
            // tracks the user's zoom intent before pdf.js re-rasterizes.
            // Resolves to 1 on commit (and during stable state).
            const previewScale = liveZoom / committedZoom;
            return (
              <div
                key={pageNum}
                className="relative"
                style={{
                  transform: previewScale === 1 ? undefined : `scale(${previewScale})`,
                  transformOrigin: "top center",
                  willChange: previewScale === 1 ? undefined : "transform",
                }}
              >
                <Page
                  pageNumber={pageNum}
                  width={containerWidth > 0 ? pageWidth : 400}
                  className="shadow-md"
                  loading={null}
                  customTextRenderer={customTextRenderer}
                />
                {pageAnnotations.map((ann) => {
                  const isActive = ann.id === activeAnnotationId;
                  const isHovered = ann.id === hoveredAnnotationId;
                  // All highlights (notes + Ask AI) share the app's primary
                  // (periwinkle) tint — the same accent used everywhere else.
                  const backgroundColor = isActive
                    ? "color-mix(in srgb, var(--primary) 32%, transparent)"
                    : isHovered
                      ? "color-mix(in srgb, var(--primary) 22%, transparent)"
                      : "color-mix(in srgb, var(--primary) 14%, transparent)";
                  return ann.anchorRects.map((r, ri) => (
                    <div
                      key={`hl-${ann.id}-${ri}`}
                      className="absolute pointer-events-none transition-[background-color,box-shadow] duration-150"
                      style={{
                        left: `${r.x * 100}%`,
                        top: `${r.y * 100}%`,
                        width: `${r.w * 100}%`,
                        height: `${r.h * 100}%`,
                        backgroundColor,
                        borderRadius: 2,
                        zIndex: 1,
                      }}
                    />
                  ));
                })}
              </div>
            );
          })}
        </Document>
      </div>
    </div>
  );
}
