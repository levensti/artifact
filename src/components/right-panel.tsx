"use client";

import type { Model } from "@/lib/models";
import type { AnalysisStatus } from "@/hooks/use-auto-analysis";
import type { Annotation } from "@/lib/annotations";
import ChatPanel from "./chat-panel";
import ModelSelector from "./model-selector";

interface RightPanelProps {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  annotations: Annotation[];
  chatThreadAnnotationId: string | null;
  onChatThreadChange: (id: string | null) => void;
  onAnnotationsPersist: () => void;
  selectedModel: Model | null;
  onModelChange: (model: Model | null) => void;
  analysisStatus: AnalysisStatus;
  analysisProgress: string | null;
  analysisError: string | null;
  canRunAnalysis: boolean;
  onTriggerAnalysis: () => boolean;
}

/**
 * Paper workspace: model picker + assistant chat. Annotations live beside the PDF
 * (comment rail), not here — avoids a redundant single-tab chrome.
 */
export default function RightPanel({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  annotations,
  chatThreadAnnotationId,
  onChatThreadChange,
  onAnnotationsPersist,
  selectedModel,
  onModelChange,
  analysisStatus,
  analysisProgress,
  analysisError,
  canRunAnalysis,
  onTriggerAnalysis,
}: RightPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center justify-end gap-2 border-b border-border bg-background px-3">
        <ModelSelector selected={selectedModel} onSelect={onModelChange} />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatPanel
          reviewId={reviewId}
          arxivId={arxivId}
          paperTitle={paperTitle}
          paperContext={paperContext}
          annotations={annotations}
          chatThreadAnnotationId={chatThreadAnnotationId}
          onChatThreadChange={onChatThreadChange}
          onAnnotationsPersist={onAnnotationsPersist}
          hideHeader
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          analysisStatus={analysisStatus}
          analysisProgress={analysisProgress}
          analysisError={analysisError}
          canRunAnalysis={canRunAnalysis}
          onTriggerAnalysis={onTriggerAnalysis}
        />
      </div>
    </div>
  );
}
