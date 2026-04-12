"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ChevronUp, ChevronDown, ZoomIn, ZoomOut, Loader2, FileWarning } from "lucide-react";
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
  /** Multiplier on fit-to-width (1 = page width matches column). */
  const [zoomMul, setZoomMul] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    Math.floor(fitWidth * Math.min(3, Math.max(0.5, zoomMul))),
  );

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

  const zoomOut = () => setZoomMul((z) => Math.max(0.5, Math.round((z - 0.12) * 100) / 100));
  const zoomIn = () => setZoomMul((z) => Math.min(3, Math.round((z + 0.12) * 100) / 100));

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="flex h-11 sm:h-14 shrink-0 items-center justify-between border-b border-border/60 bg-background/60 px-2 sm:px-4 backdrop-blur-md safe-area-x">
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
            {currentPage} / {numPages || "—"}
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
            {Math.round(zoomMul * 100)}%
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
          className="flex flex-col items-center gap-2 py-3 sm:py-4 px-2"
        >
          {Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1;
            const pageAnnotations = annotations.filter((a) => a.pageNumber === pageNum);
            return (
              <div key={pageNum} className="relative">
                <Page
                  pageNumber={pageNum}
                  width={containerWidth > 0 ? pageWidth : 400}
                  className="shadow-md"
                  loading={null}
                />
                {pageAnnotations.map((ann) => {
                  const isActive = ann.id === activeAnnotationId;
                  const isHovered = ann.id === hoveredAnnotationId;
                  const isAskAi = ann.kind === "ask_ai";
                  const backgroundColor = isAskAi
                    ? isActive
                      ? "rgba(96, 165, 250, 0.48)"
                      : isHovered
                        ? "rgba(147, 197, 253, 0.42)"
                        : "rgba(186, 230, 253, 0.36)"
                    : isActive
                      ? "rgba(250, 204, 21, 0.52)"
                      : isHovered
                        ? "rgba(252, 211, 77, 0.44)"
                        : "rgba(253, 224, 71, 0.38)";
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
                        boxShadow: isActive
                          ? `inset 0 0 0 1.5px ${isAskAi ? "color-mix(in srgb, rgb(59 130 246) 50%, transparent)" : "color-mix(in srgb, var(--primary) 55%, transparent)"}`
                          : undefined,
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
