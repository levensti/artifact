"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ChevronUp, ChevronDown, ZoomIn, ZoomOut, Loader2, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string;
  onTextExtracted: (text: string) => void;
  onTextSelected: (text: string, rect: DOMRect) => void;
  onSelectionCleared: () => void;
}

export default function PdfViewer({
  url,
  onTextExtracted,
  onTextSelected,
  onSelectionCleared,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const proxyUrl = `/api/pdf?url=${encodeURIComponent(url)}`;

  const extractText = useCallback(
    async (pdf: PDFDocumentProxy) => {
      try {
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const strings = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
          pages.push(`[Page ${i}]\n${strings}`);
        }
        onTextExtracted(pages.join("\n\n"));
      } catch (err) {
        console.error("Failed to extract text:", err);
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

    const handleMouseUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (selection && text && text.length > 0 && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        onTextSelected(text, rect);
      } else {
        onSelectionCleared();
      }
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [onTextSelected, onSelectionCleared]);

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
            closestPage = parseInt(el.getAttribute("data-page-number") || "1");
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

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 h-12 border-b border-border/60 bg-background/40 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => currentPage > 1 && goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            title="Previous page"
          >
            <ChevronUp size={14} />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums min-w-[56px] text-center font-medium">
            {currentPage} / {numPages || "—"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => currentPage < numPages && goToPage(currentPage + 1)}
            disabled={currentPage >= numPages}
            title="Next page"
          >
            <ChevronDown size={14} />
          </Button>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums min-w-[36px] text-center font-medium">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setScale((s) => Math.min(3, s + 0.2))}
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </Button>
        </div>
      </div>

      {/* PDF content */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        {loading && !loadError && (
          <div className="flex items-center justify-center h-full">
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
          file={proxyUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(err) => {
            console.error("PDF load error:", err);
            setLoading(false);
            setLoadError("Failed to load PDF. Check that the arXiv URL is valid.");
          }}
          loading={null}
          className="flex flex-col items-center gap-2 py-4"
        >
          {Array.from({ length: numPages }, (_, i) => (
            <Page
              key={i + 1}
              pageNumber={i + 1}
              scale={scale}
              className="shadow-md"
              loading={null}
            />
          ))}
        </Document>
      </div>
    </div>
  );
}
