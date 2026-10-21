"use client";

import { Loader2 } from "lucide-react";
import type { ReviewArtifact } from "@/lib/artifacts";
import {
  ArtifactCard,
  ArtifactDetail,
  type OpenArtifactOptions,
} from "./artifact-view";

/**
 * The Artifacts tab: interactive learning materials the assistant built for
 * this paper, most recently changed first, or the one that's open.
 */
export default function ArtifactsPanel({
  reviewId,
  artifacts,
  loaded,
  openArtifact,
  onClose,
  onSend,
  chatBusy,
  onViewChat,
}: {
  reviewId: string;
  artifacts: ReviewArtifact[];
  loaded: boolean;
  /** The artifact open in the tab, if any (opened from a card here or in chat). */
  openArtifact: ({ artifact: ReviewArtifact } & OpenArtifactOptions) | null;
  onClose: () => void;
  /** Send a message to the assistant about the open artifact. */
  onSend: (text: string) => void;
  chatBusy: boolean;
  onViewChat: () => void;
}) {
  if (openArtifact) {
    return (
      <ArtifactDetail
        key={openArtifact.artifact.id}
        reviewId={reviewId}
        artifact={openArtifact.artifact}
        highlightVersion={openArtifact.highlightVersion}
        onBack={onClose}
        onSend={onSend}
        chatBusy={chatBusy}
        onViewChat={onViewChat}
      />
    );
  }

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2
          className="size-4 animate-spin"
          aria-label="Loading artifacts"
        />
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 pb-4 pt-6 text-center font-sans antialiased">
        <div className="flex max-w-[220px] flex-col items-center gap-4">
          {/* Visual flow: ask in chat → artifact */}
          <div className="flex items-center gap-2 text-muted-foreground/40">
            <div className="flex h-7 items-center rounded border border-primary/10 bg-primary/8 px-2 text-[10px] font-medium text-primary/50">
              ask in chat
            </div>
            <svg
              width="16"
              height="10"
              viewBox="0 0 16 10"
              fill="none"
              className="shrink-0 text-muted-foreground/30"
            >
              <path
                d="M0 5h12M10 1l4 4-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="flex h-7 items-center rounded-md border border-border/60 bg-foreground/8 px-2 text-[10px] font-medium text-muted-foreground/50">
              artifact
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-[13px] font-semibold tracking-tight text-foreground">
              No artifacts yet
            </p>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground/60">
              Ask your assistant for interactive learning material, like an
              overview of the paper or a visual explainer of a concept. It shows
              up here so you can come back to it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {artifacts.map((a) => (
          <ArtifactCard key={a.id} artifact={a} showDate />
        ))}
      </div>
    </div>
  );
}
