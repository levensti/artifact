"use client";

import { useState } from "react";
import { Download, Loader2, Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { exportReviewToFile } from "@/lib/client/sharing/export-review";
import type { PaperReview } from "@/lib/reviews";

interface ShareReviewDialogProps {
  review: PaperReview | null;
  onClose: () => void;
}

export default function ShareReviewDialog({
  review,
  onClose,
}: ShareReviewDialogProps) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!review) return;
    setStatus("working");
    setErrorMsg(null);
    try {
      await exportReviewToFile(review.id);
      setStatus("idle");
      onClose();
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to build bundle.",
      );
    }
  };

  const sourceLabel = review?.arxivId
    ? `arXiv:${review.arxivId}`
    : review?.sourceUrl ?? "Unknown source";

  return (
    <Dialog
      open={review !== null}
      onOpenChange={(next) => {
        if (!next && status !== "working") onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Share2 className="size-[14px]" strokeWidth={2} />
            </span>
            <DialogTitle>Share this review</DialogTitle>
          </div>
          <DialogDescription>
            Download a{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              .json
            </code>{" "}
            bundle you can send to anyone. They open it with{" "}
            <span className="font-medium text-foreground">Import from file</span>{" "}
            in their own Artifact workspace.
          </DialogDescription>
        </DialogHeader>

        {review ? (
          <div className="rounded-md border border-border/70 bg-card/50 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
              Review
            </p>
            <p
              className="mt-0.5 truncate text-[13px] font-medium text-foreground"
              title={review.title}
            >
              {review.title}
            </p>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {sourceLabel}
            </p>
          </div>
        ) : null}

        <ul className="space-y-1.5 text-[12px] text-muted-foreground">
          <li className="flex gap-2">
            <span className="mt-[5px] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
            <span>
              Includes your chat history, annotations, deep dives, prerequisites,
              and the related-works graph for this paper.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-[5px] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
            <span>
              The PDF itself isn&apos;t bundled — the recipient re-fetches it
              from the source link.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-[5px] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
            <span>
              API keys and settings stay local. Nothing leaves your machine
              until you send the file yourself.
            </span>
          </li>
        </ul>

        {status === "error" && errorMsg ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            {errorMsg}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={status === "working"}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={status === "working" || !review}
          >
            {status === "working" ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Preparing…
              </>
            ) : (
              <>
                <Download className="mr-1.5 size-3.5" strokeWidth={2} />
                Download bundle
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
