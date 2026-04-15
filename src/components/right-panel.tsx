"use client";

import { useState } from "react";
import { Loader2, Share2, Sparkles } from "lucide-react";
import type { Model } from "@/lib/models";
import type { Annotation } from "@/lib/annotations";
import { exportReviewToFile } from "@/lib/client/sharing/export-review";
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
  sourceUrl?: string | null;
  /**
   * Shareable iff the review originates from arxiv or a public web URL.
   * Locally-uploaded PDFs can't be shared because bundling the PDF blob
   * raises copyright concerns we don't want to take on.
   */
  canShare?: boolean;
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
  canShare = false,
}: RightPanelProps) {
  const [shareStatus, setShareStatus] = useState<
    "idle" | "sharing" | "error"
  >("idle");

  const handleShare = async () => {
    setShareStatus("sharing");
    try {
      await exportReviewToFile(reviewId);
      setShareStatus("idle");
    } catch {
      setShareStatus("error");
      setTimeout(() => setShareStatus("idle"), 2000);
    }
  };

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
          {canShare ? (
            <button
              type="button"
              onClick={handleShare}
              disabled={shareStatus === "sharing"}
              title={
                shareStatus === "error"
                  ? "Failed to export — try again"
                  : "Export this review as a shareable file"
              }
              aria-label="Share review"
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {shareStatus === "sharing" ? (
                <Loader2 className="size-[14px] animate-spin" strokeWidth={1.75} />
              ) : (
                <Share2 className="size-[14px]" strokeWidth={1.75} />
              )}
            </button>
          ) : null}
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
          sourceUrl={sourceUrl}
        />
      </div>
    </div>
  );
}
