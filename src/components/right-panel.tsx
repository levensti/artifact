"use client";

import { Sparkles } from "lucide-react";
import type { Model } from "@/lib/models";
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
}

/**
 * Paper workspace: model picker + assistant chat. Annotations live beside the PDF
 * (notes rail), not here — avoids a redundant single-tab chrome.
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
}: RightPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3" style={{ boxShadow: "var(--shadow-panel)" }}>
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles
            className="size-4 shrink-0 text-primary"
            strokeWidth={2}
            aria-hidden
          />
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">
            Assistant
          </span>
        </div>
        <div className="min-w-0 shrink-0">
          <ModelSelector selected={selectedModel} onSelect={onModelChange} />
        </div>
      </header>

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
        />
      </div>
    </div>
  );
}
