"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ToolbarTitle from "@/components/viewer-toolbar-title";
import type { DocumentOutlineEntry } from "@/lib/documents";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ChevronUp, ChevronDown, ZoomIn, ZoomOut, Loader2, FileWarning, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { highlightBackground, type Annotation } from "@/lib/annotations";

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
  onTextExtracted: (text: string, outline?: DocumentOutlineEntry[]) => void;
  /**
   * Skip the per-page text extraction pass (the host already has the text
   * from the server). Flipping this back to false after load triggers the
   * pass late, for the case where the server copy turned out to be missing.
   */
  skipTextExtraction?: boolean;
  onTextSelected: (info: TextSelectionInfo) => void;
  onSelectionCleared: () => void;
  annotations?: Annotation[];
  activeAnnotationId?: string | null;
  hoveredAnnotationId?: string | null;
  onAnnotationClick?: (annotationId: string, info: { clickY: number; highlightRight: number; pageRight: number }) => void;
  /** Fired as the cursor moves over (or off) a highlight, with the hovered
   *  line's viewport rect + the page column edges so a margin note can dock. */
  onAnnotationHover?: (annotationId: string | null, anchor: import("@/components/note-hover-card").HoverAnchor | null) => void;
  /** Document title shown in the toolbar's title bar (hidden on narrow
   *  viewports). */
  toolbarTitle?: string;
  /** Right-aligned toolbar actions, e.g. Share. */
  toolbarActions?: ReactNode;
}

const H_PADDING = 16;
const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_DEBOUNCE_MS = 140;
/** US Letter, used for page slots until the real page sizes are known. */
const DEFAULT_ASPECT = 11 / 8.5;
/** pdf.js's own default ceiling on canvas size; past this, rendering a
 *  single page at high zoom costs hundreds of MB and seconds of raster. */
const MAX_CANVAS_PIXELS = 16_777_216;

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;"
    : c === "<" ? "&lt;"
    : c === ">" ? "&gt;"
    : c === '"' ? "&quot;"
    : "&#39;",
  );
}

/** Where the zoom focal point sat before a zoom: a page, the fractional
 *  position inside it, and the viewport offset it should stay pinned to. */
interface ZoomAnchor {
  page: number;
  fx: number;
  fy: number;
  vx: number;
  vy: number;
}

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
  skipTextExtraction = false,
  onTextSelected,
  onSelectionCleared,
  annotations = [],
  activeAnnotationId,
  hoveredAnnotationId,
  onAnnotationClick,
  onAnnotationHover,
  toolbarTitle,
  toolbarActions,
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
  /** Per-page match counts, keyed by the query they were computed for so a
   *  stale async result never pairs with a newer query. */
  const [matchState, setMatchState] = useState<{ query: string; counts: number[] }>({
    query: "",
    counts: [],
  });
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  /** Height / width of each page at scale 1, indexed by page - 1. */
  const [pageAspects, setPageAspects] = useState<number[]>([]);
  /** Pages near the viewport. Only these mount a react-pdf <Page>; the rest
   *  are empty slots of the right size, so zooming re-rasterizes a handful
   *  of pages instead of the whole document. */
  const [renderedPages, setRenderedPages] = useState<ReadonlySet<number>>(() => new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const slotRefs = useRef(new Map<number, HTMLDivElement>());
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const pageStringsRef = useRef(new Map<number, string[]>());

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
  const widthAt = (zoom: number) =>
    containerWidth > 0 ? Math.max(120, Math.floor(fitWidth * clampZoom(zoom))) : 400;
  // Slots are laid out at the live width so the document reflows the moment
  // the user zooms; pdf.js rasterizes at the committed width and the canvas
  // is CSS-scaled to fill the slot until the debounce commits.
  const slotWidth = widthAt(liveZoom);
  const renderWidth = widthAt(committedZoom);
  const previewScale = slotWidth / renderWidth;
  const aspectOf = (pageNum: number) =>
    pageAspects[pageNum - 1] ?? pageAspects[0] ?? DEFAULT_ASPECT;

  /** Record the page point under (clientX, clientY), defaulting to the
   *  viewport center, so the layout effect below can keep it in place. */
  const captureZoomAnchor = useCallback((clientX?: number, clientY?: number) => {
    const container = containerRef.current;
    if (!container) return;
    const cr = container.getBoundingClientRect();
    const px = clientX ?? cr.left + cr.width / 2;
    const py = clientY ?? cr.top + cr.height / 2;
    let best: { page: number; rect: DOMRect; dist: number } | null = null;
    for (const [page, el] of slotRefs.current) {
      const rect = el.getBoundingClientRect();
      const dist = py < rect.top ? rect.top - py : py > rect.bottom ? py - rect.bottom : 0;
      if (!best || dist < best.dist) best = { page, rect, dist };
      if (dist === 0) break;
    }
    if (!best) return;
    const { rect } = best;
    const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
    zoomAnchorRef.current = {
      page: best.page,
      fx: clamp01((px - rect.left) / rect.width),
      fy: clamp01((py - rect.top) / rect.height),
      vx: px - cr.left,
      vy: py - cr.top,
    };
  }, []);

  // After the slots resize, scroll so the anchored point is back under the
  // cursor (pinch) or viewport center (buttons) instead of drifting.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const container = containerRef.current;
    const slot = anchor && slotRefs.current.get(anchor.page);
    if (!anchor || !container || !slot) return;
    const cr = container.getBoundingClientRect();
    const sr = slot.getBoundingClientRect();
    container.scrollTop =
      sr.top - cr.top + container.scrollTop + anchor.fy * sr.height - anchor.vy;
    container.scrollLeft =
      sr.left - cr.left + container.scrollLeft + anchor.fx * sr.width - anchor.vx;
  }, [slotWidth]);

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
      captureZoomAnchor(e.clientX, e.clientY);
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
  }, [captureZoomAnchor]);

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

  const [loadedPdf, setLoadedPdf] = useState<PDFDocumentProxy | null>(null);
  const extractedRef = useRef(false);
  const onDocumentLoadSuccess = useCallback((result: { numPages: number }) => {
    setNumPages(result.numPages);
    setLoading(false);
    const pdfProxy = result as unknown as PDFDocumentProxy;
    if (typeof pdfProxy.getPage === "function") setLoadedPdf(pdfProxy);
  }, []);

  // Text items per page, shared by extraction and search. Cached because
  // search re-scans every page on each keystroke.
  useEffect(() => {
    pageStringsRef.current = new Map();
  }, [loadedPdf]);
  const getPageStrings = useCallback(
    async (pdf: PDFDocumentProxy, pageNum: number): Promise<string[]> => {
      const cached = pageStringsRef.current.get(pageNum);
      if (cached) return cached;
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const strings = content.items.map((item) => ("str" in item ? item.str : ""));
      pageStringsRef.current.set(pageNum, strings);
      return strings;
    },
    [],
  );

  // Page sizes for the placeholder slots. The first page lands right away
  // so the layout is close; the rest fill in once all are measured.
  useEffect(() => {
    if (!loadedPdf) return;
    let cancelled = false;
    void (async () => {
      const aspects: number[] = [];
      for (let i = 1; i <= loadedPdf.numPages; i++) {
        try {
          const vp = (await loadedPdf.getPage(i)).getViewport({ scale: 1 });
          aspects.push(vp.height / vp.width);
        } catch {
          aspects.push(aspects[0] ?? DEFAULT_ASPECT);
        }
        if (cancelled) return;
        if (i === 1) setPageAspects([...aspects]);
      }
      setPageAspects(aspects);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadedPdf]);

  // Mount pages within one viewport height above or below the visible area.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || numPages === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        setRenderedPages((prev) => {
          let next: Set<number> | null = null;
          for (const entry of entries) {
            const pageNum = Number((entry.target as HTMLElement).dataset.pageSlot);
            if (entry.isIntersecting === prev.has(pageNum)) continue;
            next ??= new Set(prev);
            if (entry.isIntersecting) next.add(pageNum);
            else next.delete(pageNum);
          }
          return next ?? prev;
        });
      },
      { root: container, rootMargin: "100% 0px" },
    );
    slotRefs.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [numPages]);

  // Count matches from the text content rather than the DOM, since only the
  // pages near the viewport have a text layer mounted.
  const trimmedQuery = searchQuery.trim();
  useEffect(() => {
    if (!trimmedQuery || !loadedPdf) return;
    let cancelled = false;
    const re = new RegExp(escapeRegExp(trimmedQuery), "gi");
    void (async () => {
      const counts: number[] = [];
      try {
        for (let i = 1; i <= loadedPdf.numPages; i++) {
          const strings = await getPageStrings(loadedPdf, i);
          if (cancelled) return;
          counts.push(strings.reduce((n, str) => n + (str.match(re)?.length ?? 0), 0));
        }
      } catch {
        return;
      }
      setMatchState({ query: trimmedQuery, counts });
      setActiveMatchIndex(0);
    })();
    return () => {
      cancelled = true;
    };
  }, [trimmedQuery, loadedPdf, getPageStrings]);

  const pageMatchCounts =
    trimmedQuery && matchState.query === trimmedQuery ? matchState.counts : null;
  const matchCount = pageMatchCounts?.reduce((a, b) => a + b, 0) ?? 0;

  // Highlight the active match and scroll to it. If its page isn't mounted
  // yet, jump to the page first and finish once the text layer renders.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pageMatchCounts || matchCount === 0) return;
    let page = 0;
    let local = activeMatchIndex;
    while (page < pageMatchCounts.length && local >= pageMatchCounts[page]) {
      local -= pageMatchCounts[page];
      page++;
    }
    const pageNum = page + 1;
    let scrolledToMatch = false;
    let scrolledToPage = false;
    const apply = () => {
      const slot = slotRefs.current.get(pageNum);
      if (!slot) return;
      const marks = slot.querySelectorAll<HTMLElement>(".paper-search-match");
      const mark = marks[local];
      if (!mark) {
        if (!scrolledToPage) {
          scrolledToPage = true;
          slot.scrollIntoView({ block: "center" });
        }
        return;
      }
      if (!mark.classList.contains("paper-search-match-active")) {
        container
          .querySelectorAll(".paper-search-match-active")
          .forEach((m) => m.classList.remove("paper-search-match-active"));
        mark.classList.add("paper-search-match-active");
      }
      if (!scrolledToMatch) {
        scrolledToMatch = true;
        mark.scrollIntoView({ block: "center", behavior: scrolledToPage ? "auto" : "smooth" });
      }
    };
    apply();
    // Text layers re-render on zoom and mount on scroll; re-apply the class.
    const mo = new MutationObserver(apply);
    mo.observe(container, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [activeMatchIndex, pageMatchCounts, matchCount]);

  const extractText = useCallback(
    async (pdf: PDFDocumentProxy) => {
      try {
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          if (!pdf || typeof pdf.getPage !== "function") return;
          const strings = (await getPageStrings(pdf, i)).join(" ");
          pages.push(`[Page ${i}]\n${strings}`);
        }
        const outline = await extractOutline(pdf);
        onTextExtracted(pages.join("\n\n"), outline);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("Cannot read properties of null")) {
          console.error("Failed to extract text:", err);
        }
      }
    },
    [onTextExtracted, getPageStrings],
  );

  // Extract once the document is loaded unless the host already has the
  // text; re-evaluated if `skipTextExtraction` flips to false later.
  useEffect(() => {
    if (!loadedPdf || skipTextExtraction || extractedRef.current) return;
    extractedRef.current = true;
    extractText(loadedPdf);
  }, [loadedPdf, skipTextExtraction, extractText]);

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

  // Hover detection for margin notes. Highlights stay `pointer-events-none`
  // (so text selection over them still works), so we hit-test geometrically
  // on mousemove, rAF-throttled, emitting only when the hovered id changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onAnnotationHover) return;

    let rafId: number | null = null;
    let lastId: string | null = null;

    const hitTest = (cx: number, cy: number) => {
      const target =
        (document.elementFromPoint(cx, cy) as Element | null) ?? null;
      const pageEl = target?.closest("[data-page-number]");
      if (!pageEl) return null;
      const pageRect = pageEl.getBoundingClientRect();
      const nx = (cx - pageRect.left) / pageRect.width;
      const ny = (cy - pageRect.top) / pageRect.height;
      const pageNum = parseInt(
        pageEl.getAttribute("data-page-number") || "0",
        10,
      );
      for (const ann of annotations) {
        if (ann.pageNumber !== pageNum) continue;
        for (const r of ann.anchorRects) {
          if (nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h) {
            return {
              id: ann.id,
              top: pageRect.top + r.y * pageRect.height,
              bottom: pageRect.top + (r.y + r.h) * pageRect.height,
              left: pageRect.left + r.x * pageRect.width,
              right: pageRect.left + (r.x + r.w) * pageRect.width,
              colLeft: pageRect.left,
              colRight: pageRect.right,
            };
          }
        }
      }
      return null;
    };

    const onMove = (e: MouseEvent) => {
      if (rafId !== null) return;
      const { clientX, clientY } = e;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const hit = hitTest(clientX, clientY);
        const id = hit?.id ?? null;
        if (id === lastId) return;
        lastId = id;
        if (hit) {
          onAnnotationHover(hit.id, {
            top: hit.top,
            bottom: hit.bottom,
            left: hit.left,
            right: hit.right,
            colLeft: hit.colLeft,
            colRight: hit.colRight,
          });
        } else {
          onAnnotationHover(null, null);
        }
      });
    };

    container.addEventListener("mousemove", onMove);
    return () => {
      container.removeEventListener("mousemove", onMove);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [annotations, onAnnotationHover]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        let closestPage = 1;
        let closestDistance = Infinity;
        const containerTop = container.getBoundingClientRect().top;

        slotRefs.current.forEach((el, pageNum) => {
          const distance = Math.abs(el.getBoundingClientRect().top - containerTop);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestPage = pageNum;
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
    slotRefs.current.get(page)?.scrollIntoView({ behavior: "smooth" });
  };

  const customTextRenderer = useCallback(
    (item: { str: string }) => {
      if (!trimmedQuery) return escapeHtml(item.str);
      // Match on the raw text and escape each piece, so the count agrees with
      // the text-content search above and a query like "amp" can't land
      // inside an escaped entity.
      const re = new RegExp(`(${escapeRegExp(trimmedQuery)})`, "gi");
      return item.str
        .split(re)
        .map((part, i) =>
          i % 2 === 1
            ? `<mark class="paper-search-match">${escapeHtml(part)}</mark>`
            : escapeHtml(part),
        )
        .join("");
    },
    [trimmedQuery],
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
  }, []);

  const zoomOut = () => {
    captureZoomAnchor();
    setLiveZoom((z) =>
      Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100),
    );
  };
  const zoomIn = () => {
    captureZoomAnchor();
    setLiveZoom((z) =>
      Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100),
    );
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="flex h-11 sm:h-14 shrink-0 items-center gap-3 border-b border-border bg-background pl-[max(env(safe-area-inset-left),0.75rem)] pr-[max(env(safe-area-inset-right),0.75rem)] sm:pl-[max(env(safe-area-inset-left),1rem)] sm:pr-[max(env(safe-area-inset-right),1rem)]">
        <div className="flex h-7 sm:h-8 shrink-0 items-center rounded-md border border-border bg-card">
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
          <span className="min-w-[52px] sm:min-w-[56px] text-center font-mono text-[11px] tabular-nums leading-none text-muted-foreground">
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
        <ToolbarTitle title={toolbarTitle} />
        <div className="flex h-7 sm:h-8 shrink-0 items-center rounded-md border border-border bg-card">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 sm:size-7"
            onClick={zoomOut}
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </Button>
          <span className="min-w-[36px] sm:min-w-[40px] text-center font-mono text-[11px] tabular-nums leading-none text-muted-foreground">
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
        {toolbarActions}
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
            const slotHeight = slotWidth * aspectOf(pageNum);
            return (
              // The slot owns layout at the live zoom; `data-page-number` lives
              // here (not only on react-pdf's inner div) so citation jumps and
              // highlight clicks can find pages that aren't mounted.
              <div
                key={pageNum}
                ref={(el) => {
                  if (el) slotRefs.current.set(pageNum, el);
                  else slotRefs.current.delete(pageNum);
                }}
                data-page-slot={pageNum}
                data-page-number={pageNum}
                className="relative shrink-0 bg-white shadow-md"
                style={{ width: slotWidth, height: slotHeight }}
              >
                {renderedPages.has(pageNum) && (
                  // Rasterized at the committed width, CSS-scaled to the slot
                  // during the debounce window; resolves to scale 1 on commit.
                  <div
                    className="absolute left-0 top-0"
                    style={{
                      width: renderWidth,
                      transform: previewScale === 1 ? undefined : `scale(${previewScale})`,
                      transformOrigin: "0 0",
                    }}
                  >
                    <PdfPage
                      pageNumber={pageNum}
                      width={renderWidth}
                      height={renderWidth * aspectOf(pageNum)}
                      customTextRenderer={customTextRenderer}
                    />
                  </div>
                )}
                {pageAnnotations.map((ann) => {
                  const isActive = ann.id === activeAnnotationId;
                  const isHovered = ann.id === hoveredAnnotationId;
                  const backgroundColor = highlightBackground(
                    ann.kind,
                    isActive ? "active" : isHovered ? "hovered" : "idle",
                  );
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

/**
 * One rasterized page. Memoized so live-zoom renders, which only resize the
 * slots, don't reconcile every mounted <Page>.
 */
const PdfPage = memo(function PdfPage({
  pageNumber,
  width,
  height,
  customTextRenderer,
}: {
  pageNumber: number;
  width: number;
  height: number;
  customTextRenderer: (item: { str: string }) => string;
}) {
  // Cap the backing store at pdf.js's canvas limit so 300% on a retina
  // screen doesn't allocate a 40-megapixel canvas per page.
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const devicePixelRatio = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
  return (
    <Page
      pageNumber={pageNumber}
      width={width}
      devicePixelRatio={devicePixelRatio}
      loading={null}
      customTextRenderer={customTextRenderer}
    />
  );
});

/**
 * Flatten the PDF's outline (bookmarks) into `{ title, page, depth }`
 * entries, resolving each destination to a 1-based page. Best-effort: any
 * entry that can't be resolved is skipped, and a PDF without an outline
 * yields an empty array (the server then falls back to heading detection).
 */
async function extractOutline(pdf: PDFDocumentProxy): Promise<DocumentOutlineEntry[]> {
  const out: DocumentOutlineEntry[] = [];
  let items: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>;
  try {
    items = await pdf.getOutline();
  } catch {
    return out;
  }
  if (!items) return out;

  const resolvePage = async (dest: unknown): Promise<number | null> => {
    try {
      let explicit = dest;
      if (typeof dest === "string") explicit = await pdf.getDestination(dest);
      if (!Array.isArray(explicit) || explicit.length === 0) return null;
      const ref = explicit[0];
      if (typeof ref === "number") return ref + 1;
      const index = await pdf.getPageIndex(ref);
      return index + 1;
    } catch {
      return null;
    }
  };

  const walk = async (nodes: typeof items, depth: number) => {
    for (const node of nodes) {
      if (out.length >= 2000) return;
      const page = await resolvePage(node.dest);
      if (page !== null && node.title?.trim()) {
        out.push({ title: node.title.trim(), page, depth });
      }
      if (node.items?.length) await walk(node.items, depth + 1);
    }
  };
  await walk(items, 0);
  return out;
}
