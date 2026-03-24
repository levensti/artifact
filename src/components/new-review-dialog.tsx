"use client";

import { useState } from "react";
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
import { createReview, REVIEWS_UPDATED_EVENT } from "@/lib/reviews";
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

      const review = createReview(arxivId, paperTitle);
      window.dispatchEvent(new Event(REVIEWS_UPDATED_EVENT));

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New paper review</DialogTitle>
          <DialogDescription>
            Paste an arXiv URL. The sidebar title is taken from the paper&apos;s
            arXiv entry when available.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                arXiv URL
              </label>
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
              {arxivId && (
                <p className="text-xs text-primary font-medium">
                  Detected: {arxivId}
                </p>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          </div>

          <DialogFooter className="pt-2">
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
                  Fetching paper…
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
