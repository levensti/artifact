"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import PdfViewer from "@/components/pdf-viewer";
import ChatPanel from "@/components/chat-panel";
import SelectionPopover from "@/components/selection-popover";
import { getStudy, type Study } from "@/lib/studies";
import { arxivPdfUrl } from "@/lib/utils";

export default function StudyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [study, setStudy] = useState<Study | null>(null);
  const [paperText, setPaperText] = useState("");
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(440);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const s = getStudy(params.id);
    if (!s) {
      router.push("/");
      return;
    }
    setStudy(s);
  }, [params.id, router]);

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

  if (!study) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full text-text-muted text-sm">
          Loading...
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex h-full overflow-hidden">
        {/* PDF Viewer */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <PdfViewer
            url={arxivPdfUrl(study.arxivId)}
            onTextExtracted={setPaperText}
            onTextSelected={handleTextSelected}
            onSelectionCleared={handleSelectionCleared}
          />
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className={`relative w-px cursor-col-resize flex items-center justify-center transition-colors shrink-0 ${isDragging ? "bg-accent/40" : "bg-border hover:bg-border-light"}`}
        >
          <div className="absolute p-0.5 rounded bg-bg-elevated border border-border opacity-0 hover:opacity-100 transition-opacity">
            <GripVertical size={10} className="text-text-muted" />
          </div>
        </div>

        {/* Chat Panel */}
        <div
          className="shrink-0 overflow-hidden"
          style={{ width: `${panelWidth}px` }}
        >
          <ChatPanel
            studyId={study.id}
            paperContext={paperText}
            pendingSelection={pendingSelection}
            onSelectionConsumed={() => setPendingSelection(null)}
          />
        </div>
      </div>

      {/* Selection popover */}
      {selectedText && selectionRect && (
        <SelectionPopover rect={selectionRect} onAsk={handleAskAboutSelection} />
      )}
    </DashboardLayout>
  );
}
