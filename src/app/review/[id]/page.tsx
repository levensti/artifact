"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { GripVertical, Loader2 } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import ChatPanel from "@/components/chat-panel";
import SelectionPopover from "@/components/selection-popover";
import { getReview } from "@/lib/reviews";
import { arxivPdfUrl } from "@/lib/utils";

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
  /** Avoid hydration mismatch: localStorage is empty on the server. */
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => {
    queueMicrotask(() => {
      setClientReady(true);
    });
  }, []);

  const review = useMemo(() => {
    if (!clientReady) return undefined;
    return getReview(params.id);
  }, [clientReady, params.id]);

  const [paperText, setPaperText] = useState("");
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(440);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!clientReady) return;
    if (!getReview(params.id)) {
      router.push("/");
    }
  }, [clientReady, params.id, router]);

  const handleTextSelected = useCallback((text: string, rect: DOMRect) => {
    setSelectedText(text);
    setSelectionRect(rect);
  }, []);

  const handleSelectionCleared = useCallback(() => {
    setSelectedText(null);
    setSelectionRect(null);
  }, []);

  const handleAskAboutSelection = useCallback(() => {
    if (selectedText) {
      setPendingSelection(selectedText);
      setSelectedText(null);
      setSelectionRect(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [selectedText]);

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      setPanelWidth(Math.max(340, Math.min(800, newWidth)));
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
        <div className="flex-1 min-w-0 overflow-hidden bg-[var(--reader-mat)]">
          <PdfViewer
            url={arxivPdfUrl(review.arxivId)}
            onTextExtracted={setPaperText}
            onTextSelected={handleTextSelected}
            onSelectionCleared={handleSelectionCleared}
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
          <ChatPanel
            reviewId={review.id}
            paperContext={paperText}
            pendingSelection={pendingSelection}
            onSelectionConsumed={() => setPendingSelection(null)}
          />
        </div>
      </div>

      {selectedText && selectionRect && (
        <SelectionPopover rect={selectionRect} onAsk={handleAskAboutSelection} />
      )}
    </DashboardLayout>
  );
}
