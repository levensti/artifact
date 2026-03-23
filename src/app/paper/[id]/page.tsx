"use client";

import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Settings, Sparkles, GripVertical } from "lucide-react";
import PdfViewer from "@/components/pdf-viewer";
import ChatPanel from "@/components/chat-panel";
import SelectionPopover from "@/components/selection-popover";
import SettingsModal from "@/components/settings-modal";
import { arxivPdfUrl } from "@/lib/utils";

export default function PaperPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const pdfUrl = arxivPdfUrl(params.id);

  const [paperText, setPaperText] = useState("");
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(420);
  const [isDragging, setIsDragging] = useState(false);

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
      setPanelWidth(Math.max(320, Math.min(800, newWidth)));
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

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <nav className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-secondary shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="p-1.5 rounded-md hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <span className="text-sm font-medium">Paper Copilot</span>
          </div>
          <span className="text-text-muted text-xs">
            arxiv:{params.id}
          </span>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-1.5 rounded-md hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
        >
          <Settings size={16} />
        </button>
      </nav>

      {/* Split view */}
      <div className="flex flex-1 overflow-hidden">
        {/* PDF Viewer */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <PdfViewer
            url={pdfUrl}
            onTextExtracted={setPaperText}
            onTextSelected={handleTextSelected}
            onSelectionCleared={handleSelectionCleared}
          />
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className={`w-1 cursor-col-resize flex items-center justify-center hover:bg-accent/30 transition-colors shrink-0 ${isDragging ? "bg-accent/30" : "bg-border"}`}
        >
          <GripVertical size={12} className="text-text-muted" />
        </div>

        {/* Chat Panel */}
        <div
          className="shrink-0 overflow-hidden"
          style={{ width: `${panelWidth}px` }}
        >
          <ChatPanel
            paperContext={paperText}
            pendingSelection={pendingSelection}
            onSelectionConsumed={() => setPendingSelection(null)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>
      </div>

      {/* Selection popover */}
      {selectedText && selectionRect && (
        <SelectionPopover rect={selectionRect} onAsk={handleAskAboutSelection} />
      )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
