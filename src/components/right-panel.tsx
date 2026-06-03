"use client";

import { PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react";
import type { Model } from "@/lib/models";
import type { Annotation } from "@/lib/annotations";
import ChatPanel from "./chat-panel";

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
  sourceUrl?: string | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
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
  sourceUrl,
  collapsed = false,
  onToggleCollapsed,
}: RightPanelProps) {
  if (collapsed && onToggleCollapsed) {
    return (
      <aside className="flex h-full min-h-0 w-9 shrink-0 flex-col items-center border-l border-border bg-background">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand assistant"
          aria-label="Expand assistant"
          className="flex h-14 w-full shrink-0 items-center justify-center border-b border-border text-muted-foreground hover:text-foreground hover:bg-muted/60"
        >
          <PanelRightOpen className="size-[15px]" strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Expand assistant"
          aria-label="Expand assistant"
          className="flex flex-1 w-full items-start justify-center pt-3 text-muted-foreground hover:text-foreground hover:bg-muted/60"
        >
          <Sparkles className="size-[15px]" strokeWidth={2} aria-hidden />
        </button>
      </aside>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles
            className="size-[15px] shrink-0 text-muted-foreground"
            strokeWidth={2}
            aria-hidden
          />
          <span className="truncate text-[13px] font-semibold tracking-tight text-foreground">
            Assistant
          </span>
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-1.5">
          {onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              title="Collapse assistant"
              aria-label="Collapse assistant"
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <PanelRightClose className="size-[15px]" strokeWidth={2} aria-hidden />
            </button>
          ) : null}
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
          sourceUrl={sourceUrl}
        />
      </div>
    </div>
  );
}
