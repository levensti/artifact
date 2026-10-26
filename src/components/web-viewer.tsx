"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ExternalLink, Loader2, FileWarning } from "lucide-react";
import type { TextSelectionInfo } from "@/components/pdf-viewer";
import ToolbarTitle from "@/components/viewer-toolbar-title";
import { highlightBackground, type Annotation } from "@/lib/annotations";

/**
 * Web reader. Shows the review's frozen page snapshot (see
 * /api/reviews/[id]/snapshot) in a sandboxed, script-free iframe, so the
 * page renders with its own markup and styles rather than a re-typeset
 * extraction. The snapshot is fetched straight from storage (gzipped,
 * inflated here) and loaded through a blob: URL, which is same-origin with
 * this page: the host reads selections, element positions and text straight
 * out of the frame's DOM, and no server function carries the document body.
 *
 * The frame is sized to its content and never scrolls itself; the
 * surrounding container does, which keeps the geometry-based annotation
 * model shared with PdfViewer: anchor rects are fractions of the frame box,
 * and highlight overlays sit on top of it in the host document.
 */

type SnapshotPointer =
  | { format: "gzip"; url: string }
  | { format: "inline"; html: string }
  | { error?: string };

/** Resolve the snapshot HTML for a review: a signed storage URL inflated in
 *  the browser, with the route's own inflating endpoint as the fallback. */
async function loadSnapshotHtml(
  routeUrl: string,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(routeUrl, { signal });
  const pointer = (await res.json().catch(() => ({}))) as SnapshotPointer;
  if (!res.ok || !("format" in pointer)) {
    const message = "error" in pointer && pointer.error;
    throw new Error(message || `Request failed: ${res.status}`);
  }
  if (pointer.format === "inline") return pointer.html;

  if (typeof DecompressionStream === "function") {
    const gz = await fetch(pointer.url, { signal });
    if (gz.ok && gz.body) {
      const inflated = gz.body.pipeThrough(new DecompressionStream("gzip"));
      return await new Response(inflated).text();
    }
  }
  const direct = await fetch(`${routeUrl}?format=html`, { signal });
  if (!direct.ok) throw new Error(`Request failed: ${direct.status}`);
  return await direct.text();
}

interface WebViewerProps {
  reviewId: string;
  sourceUrl: string;
  onTextExtracted: (text: string) => void;
  onTextSelected?: (info: TextSelectionInfo) => void;
  onSelectionCleared?: () => void;
  annotations?: Annotation[];
  activeAnnotationId?: string | null;
  hoveredAnnotationId?: string | null;
  onAnnotationClick?: (
    annotationId: string,
    info: { clickY: number; highlightRight: number; pageRight: number },
  ) => void;
  onAnnotationHover?: (
    annotationId: string | null,
    anchor: import("@/components/note-hover-card").HoverAnchor | null,
  ) => void;
  /** Document title shown in the toolbar's title bar (hidden on narrow
   *  viewports). */
  toolbarTitle?: string;
  /** Leads the toolbar title, e.g. the paper's project breadcrumb. */
  toolbarCrumb?: ReactNode;
  /** Right-aligned toolbar actions, e.g. Share. */
  toolbarActions?: ReactNode;
}

function pointerClient(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ("changedTouches" in e && e.changedTouches[0]) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  const m = e as MouseEvent;
  return { x: m.clientX, y: m.clientY };
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function WebViewer({
  reviewId,
  sourceUrl,
  onTextExtracted,
  onTextSelected,
  onSelectionCleared,
  annotations = [],
  activeAnnotationId,
  hoveredAnnotationId,
  onAnnotationClick,
  onAnnotationHover,
  toolbarTitle,
  toolbarCrumb,
  toolbarActions,
}: WebViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Set once the frame's document is readable; effects that need the DOM
   *  key off it. */
  const [frameDoc, setFrameDoc] = useState<Document | null>(null);
  const [frameHeight, setFrameHeight] = useState<number>(0);
  /** blob: URL holding the snapshot document, revoked on change. */
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** The frame document whose text was last handed to the host. */
  const extractedDocRef = useRef<Document | null>(null);

  const snapshotUrl = `/api/reviews/${encodeURIComponent(reviewId)}/snapshot`;
  const siteName = safeHostname(sourceUrl);

  // ── Fetch the snapshot and hand it to the frame ─────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    loadSnapshotHtml(snapshotUrl, controller.signal)
      .then((html) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(
          new Blob([html], { type: "text/html" }),
        );
        setBlobUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error ? err.message : "Could not load this page",
        );
        setLoading(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [snapshotUrl]);

  const handleLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      setError("Could not load this page");
      setLoading(false);
      return;
    }
    setFrameDoc(doc);
    setLoading(false);
  }, []);

  // Reset when the review changes (state derived from a prop, adjusted
  // during render rather than in an effect).
  const [loadedFor, setLoadedFor] = useState(snapshotUrl);
  if (loadedFor !== snapshotUrl) {
    setLoadedFor(snapshotUrl);
    setLoading(true);
    setError(null);
    setFrameDoc(null);
    setFrameHeight(0);
    setBlobUrl(null);
  }

  // ── Size the frame to its content ──────────────────────────────────────
  useEffect(() => {
    if (!frameDoc) return;
    const root = frameDoc.documentElement;
    const body = frameDoc.body;
    if (!root) return;
    let raf: number | null = null;
    const measure = () => {
      raf = null;
      const h = Math.max(
        root.scrollHeight,
        body?.scrollHeight ?? 0,
        root.getBoundingClientRect().height,
      );
      setFrameHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
    };
    const schedule = () => {
      if (raf === null) raf = requestAnimationFrame(measure);
    };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    if (body) ro.observe(body);
    // Images that finish loading after the first measure.
    frameDoc.addEventListener("load", schedule, true);
    return () => {
      ro.disconnect();
      frameDoc.removeEventListener("load", schedule, true);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [frameDoc]);

  // ── Text for the assistant ─────────────────────────────────────────────
  useEffect(() => {
    if (!frameDoc || extractedDocRef.current === frameDoc) return;
    extractedDocRef.current = frameDoc;
    const body = frameDoc.body;
    if (!body) {
      onTextExtracted("");
      return;
    }
    // innerText is layout-aware: hidden elements are skipped and block
    // boundaries become line breaks, which reads far better than textContent.
    // But it also skips subtrees under `content-visibility: auto` that the
    // browser hasn't rendered yet (paged documents such as SEC filings wrap
    // every page in it), which can leave it empty. Force everything
    // renderable for the read, then put the page back.
    const override = frameDoc.createElement("style");
    override.textContent = "*{content-visibility:visible!important}";
    frameDoc.head?.appendChild(override);
    let text = "";
    try {
      text = body.innerText ?? "";
    } finally {
      override.remove();
    }
    if (!text.trim()) text = body.textContent ?? "";
    onTextExtracted(text);
  }, [frameDoc, onTextExtracted]);

  // ── Links: in-page anchors scroll the host container; the rest open in a
  //    new tab. The sandbox has no navigation rights of its own. ──────────
  useEffect(() => {
    if (!frameDoc) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      e.preventDefault();
      if (href.startsWith("#")) {
        const id = decodeURIComponent(href.slice(1));
        if (!id) return;
        const el =
          frameDoc.getElementById(id) ??
          frameDoc.querySelector(`a[name="${CSS.escape(id)}"]`);
        const container = containerRef.current;
        const iframe = iframeRef.current;
        if (el && container && iframe) {
          const top =
            el.getBoundingClientRect().top +
            iframe.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            container.scrollTop -
            16;
          container.scrollTo({ top, behavior: "smooth" });
        }
        return;
      }
      if (/^https?:/i.test(href) || href.startsWith("mailto:")) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    };
    frameDoc.addEventListener("click", onClick);
    return () => frameDoc.removeEventListener("click", onClick);
  }, [frameDoc]);

  // ── Selection + annotation hit-testing inside the frame ────────────────
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    const iframe = iframeRef.current;
    if (!frameDoc || !container || !content || !iframe) return;
    if (!onTextSelected && !onSelectionCleared && !onAnnotationClick) return;

    const hitAnnotation = (hostX: number, hostY: number) => {
      const contentRect = content.getBoundingClientRect();
      const nx = (hostX - contentRect.left) / contentRect.width;
      const ny = (hostY - contentRect.top) / contentRect.height;
      for (const ann of annotations) {
        if (ann.pageNumber !== 1) continue;
        for (const r of ann.anchorRects) {
          if (nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h) {
            return { ann, r, contentRect };
          }
        }
      }
      return null;
    };

    const handleFramePointerUp = (e: MouseEvent | TouchEvent) => {
      const frameRect = iframe.getBoundingClientRect();
      const sel = frameDoc.getSelection();
      const text = sel?.toString().trim();
      if (!text || !sel || sel.rangeCount === 0) {
        onSelectionCleared?.();
        if (onAnnotationClick) {
          const { x, y } = pointerClient(e);
          const hit = hitAnnotation(x + frameRect.left, y + frameRect.top);
          if (hit) {
            onAnnotationClick(hit.ann.id, {
              clickY: y + frameRect.top,
              highlightRight:
                hit.contentRect.left +
                (hit.r.x + hit.r.w) * hit.contentRect.width,
              pageRight: hit.contentRect.right,
            });
          }
        }
        return;
      }
      const range = sel.getRangeAt(0);
      const contentRect = content.getBoundingClientRect();
      const clientRects = range.getClientRects();
      const anchorRects: { x: number; y: number; w: number; h: number }[] = [];
      for (let i = 0; i < clientRects.length; i++) {
        const r = clientRects[i];
        if (r.width === 0 || r.height === 0) continue;
        anchorRects.push({
          x: (r.left + frameRect.left - contentRect.left) / contentRect.width,
          y: (r.top + frameRect.top - contentRect.top) / contentRect.height,
          w: r.width / contentRect.width,
          h: r.height / contentRect.height,
        });
      }
      const b = range.getBoundingClientRect();
      // Host-viewport coordinates, which is what the selection popover expects.
      const rect = new DOMRect(
        b.left + frameRect.left,
        b.top + frameRect.top,
        b.width,
        b.height,
      );
      onTextSelected?.({ text, rect, pageNumber: 1, anchorRects });
    };

    // Clicks on the host side of the reader (margins) clear the selection.
    const handleHostPointerUp = (e: MouseEvent | TouchEvent) => {
      if (e.target === iframe) return;
      const sel = frameDoc.getSelection();
      if (!sel?.toString().trim()) onSelectionCleared?.();
    };

    frameDoc.addEventListener("mouseup", handleFramePointerUp);
    frameDoc.addEventListener("touchend", handleFramePointerUp, {
      passive: true,
    });
    container.addEventListener("mouseup", handleHostPointerUp);
    return () => {
      frameDoc.removeEventListener("mouseup", handleFramePointerUp);
      frameDoc.removeEventListener("touchend", handleFramePointerUp);
      container.removeEventListener("mouseup", handleHostPointerUp);
    };
  }, [
    frameDoc,
    onTextSelected,
    onSelectionCleared,
    onAnnotationClick,
    annotations,
  ]);

  // ── Hover detection for margin notes (highlights are pointer-events-none,
  //    so hit-test geometrically on mousemove inside the frame) ───────────
  useEffect(() => {
    const content = contentRef.current;
    const iframe = iframeRef.current;
    if (!frameDoc || !content || !iframe || !onAnnotationHover) return;

    let rafId: number | null = null;
    let lastId: string | null = null;

    const onMove = (e: MouseEvent) => {
      if (rafId !== null) return;
      const { clientX, clientY } = e;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const frameRect = iframe.getBoundingClientRect();
        const cx = clientX + frameRect.left;
        const cy = clientY + frameRect.top;
        const contentRect = content.getBoundingClientRect();
        const nx = (cx - contentRect.left) / contentRect.width;
        const ny = (cy - contentRect.top) / contentRect.height;
        let hit:
          | ({
              id: string;
            } & import("@/components/note-hover-card").HoverAnchor)
          | null = null;
        outer: for (const ann of annotations) {
          if (ann.pageNumber !== 1) continue;
          for (const r of ann.anchorRects) {
            if (nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h) {
              hit = {
                id: ann.id,
                top: contentRect.top + r.y * contentRect.height,
                bottom: contentRect.top + (r.y + r.h) * contentRect.height,
                left: contentRect.left + r.x * contentRect.width,
                right: contentRect.left + (r.x + r.w) * contentRect.width,
                colLeft: contentRect.left,
                colRight: contentRect.right,
              };
              break outer;
            }
          }
        }
        const id = hit?.id ?? null;
        if (id === lastId) return;
        lastId = id;
        if (hit) {
          const { id: hitId, ...anchor } = hit;
          onAnnotationHover(hitId, anchor);
        } else {
          onAnnotationHover(null, null);
        }
      });
    };

    frameDoc.addEventListener("mousemove", onMove);
    return () => {
      frameDoc.removeEventListener("mousemove", onMove);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [frameDoc, annotations, onAnnotationHover]);

  const pageAnnotations = annotations.filter((a) => a.pageNumber === 1);

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Toolbar */}
      <div className="flex h-11 sm:h-14 shrink-0 items-center gap-3 border-b border-border bg-background pl-[max(env(safe-area-inset-left),0.75rem)] pr-[max(env(safe-area-inset-right),0.75rem)] sm:pl-[max(env(safe-area-inset-left),1rem)] sm:pr-[max(env(safe-area-inset-right),1rem)]">
        <span className="min-w-0 max-w-[40%] shrink truncate font-mono text-[11px] text-muted-foreground">
          {siteName}
        </span>
        <ToolbarTitle title={toolbarTitle} crumb={toolbarCrumb} />
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-8"
        >
          Open original
          <ExternalLink size={12} />
        </a>
        {toolbarActions}
      </div>

      {/* Content */}
      <div ref={containerRef} className="relative flex-1 overflow-auto">
        {loading && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-(--reader-mat)">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        )}
        {error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
            <FileWarning className="text-destructive" size={28} />
            <p className="text-sm text-muted-foreground">{error}</p>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline underline-offset-2"
            >
              Open the original page
            </a>
          </div>
        ) : (
          <div ref={contentRef} className="relative w-full bg-white">
            {blobUrl && (
              <iframe
                ref={iframeRef}
                key={blobUrl}
                src={blobUrl}
                title={toolbarTitle ?? siteName}
                sandbox="allow-same-origin"
                referrerPolicy="no-referrer"
                onLoad={handleLoad}
                scrolling="no"
                className="block w-full border-0"
                style={{
                  height: frameHeight > 0 ? frameHeight : "100vh",
                  overflow: "hidden",
                  visibility: loading ? "hidden" : "visible",
                }}
              />
            )}
            {/* Annotation highlight overlays */}
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
                  {...(ri === 0 ? { "data-annotation-id": ann.id } : {})}
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
        )}
      </div>
    </div>
  );
}
