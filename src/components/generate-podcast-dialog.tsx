"use client";

import { useState } from "react";
import { ArrowRight, Podcast } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MonoLabel } from "@/components/folio";
import { PODCAST_INSTRUCTIONS_MAX } from "@/lib/podcast";

interface GeneratePodcastDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fired on confirm with the (possibly empty) steer. Empty = default episode. */
  onConfirm: (instructions: string) => void;
}

/**
 * The required pre-generation step: the user frames the episode before any work
 * starts. Not an inline box — a deliberate dialog so every episode is
 * intentional, per the product decision.
 */
export default function GeneratePodcastDialog({
  open,
  onClose,
  onConfirm,
}: GeneratePodcastDialogProps) {
  const [instructions, setInstructions] = useState("");

  // Reset on close so a prior draft never lingers into the next open. (Done
  // here rather than in an effect to avoid a synchronous in-effect setState.)
  const reset = () => {
    setInstructions("");
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      reset();
      onClose();
    }
  };

  const handleConfirm = () => {
    onConfirm(instructions.trim());
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-2">
          <MonoLabel>New episode</MonoLabel>
          <DialogTitle className="flex items-center gap-2 text-[20px] font-semibold leading-[1.15] tracking-[-0.022em]">
            <Podcast className="size-4.5" strokeWidth={2} aria-hidden />
            Generate a podcast
          </DialogTitle>
          <DialogDescription
            className="text-[13.5px] leading-[1.55]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
            }}
          >
            Walk through the paper with a short audio episode.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3">
          <textarea
            value={instructions}
            onChange={(e) => {
              setInstructions(
                e.target.value.slice(0, PODCAST_INSTRUCTIONS_MAX),
              );
            }}
            placeholder="Any stylistic preferences for the episode? (optional)"
            rows={3}
            autoFocus
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-[1.5] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            style={{ fontFamily: "var(--font-reading)" }}
          />
          <div className="mt-1 text-right text-[11px] tabular-nums text-muted-foreground">
            {instructions.length}/{PODCAST_INSTRUCTIONS_MAX}
          </div>
        </div>

        <DialogFooter className="mt-2 border-t border-border/40 pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            className="group h-9 gap-1.5 px-4 text-[13px] font-medium shadow-[var(--shadow-primary)] transition-all duration-150 hover:bg-primary/90 active:translate-y-px"
          >
            Generate
            <ArrowRight
              className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
