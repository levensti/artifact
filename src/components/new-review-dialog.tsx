"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createOrGetReview,
  getReviewByArxivId,
  REVIEWS_UPDATED_EVENT,
  type PaperReview,
} from "@/lib/reviews";
import { extractArxivId } from "@/lib/utils";

interface NewReviewDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (reviewId: string) => void;
}

export default function NewReviewDialog({
  open,
  onClose,
  onCreated,
}: NewReviewDialogProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const arxivId = extractArxivId(url);
  const [existingReview, setExistingReview] = useState<
    PaperReview | undefined
  >(undefined);

  useEffect(() => {
    const sync = () => {
      setExistingReview(
        arxivId ? getReviewByArxivId(arxivId) : undefined,
      );
    };
    sync();
    window.addEventListener(REVIEWS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(REVIEWS_UPDATED_EVENT, sync);
  }, [arxivId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError("Please enter an arXiv URL");
      return;
    }

    if (!arxivId) {
      setError(
        "Enter a valid arXiv URL (e.g. https://arxiv.org/abs/2602.00277)",
      );
      return;
    }

    if (existingReview) {
      setUrl("");
      onCreated(existingReview.id);
      return;
    }

    setLoading(true);
    try {
      let paperTitle = `arXiv:${arxivId}`;
      try {
        const res = await fetch(
          `/api/arxiv-metadata?id=${encodeURIComponent(arxivId)}`,
        );
        if (res.ok) {
          const data: { title?: string | null } = await res.json();
          if (typeof data.title === "string" && data.title.trim()) {
            paperTitle = data.title.trim();
          }
        }
      } catch {
        /* keep fallback */
      }

      const review = await createOrGetReview(arxivId, paperTitle);

      setUrl("");
      onCreated(review.id);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setUrl("");
      setError(null);
      setLoading(false);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New review</DialogTitle>
          <DialogDescription>
            Paste a link to any arXiv paper.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-2">
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="https://arxiv.org/abs/2602.00277"
            autoFocus
            disabled={loading}
          />
          {arxivId && existingReview && (
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              You already have a review for this paper. Continue to open it, or
              paste a different link.
            </p>
          )}
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}

          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!url.trim() || loading}>
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Loading…
                </>
              ) : existingReview ? (
                <>
                  Open review
                  <ArrowRight size={14} />
                </>
              ) : (
                <>
                  Start review
                  <ArrowRight size={14} />
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
