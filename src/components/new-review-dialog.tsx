"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, Globe, Loader2, Upload } from "lucide-react";
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
  createLocalPdfReview,
  getReviewByArxivId,
  REVIEWS_UPDATED_EVENT,
  type PaperReview,
} from "@/lib/reviews";
import { extractArxivId } from "@/lib/utils";

type SourceMode = "arxiv" | "local";

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
  const [mode, setMode] = useState<SourceMode>("arxiv");
  const [url, setUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const arxivId = extractArxivId(url);
  const [existingReview, setExistingReview] = useState<PaperReview | undefined>(
    undefined,
  );

  useEffect(() => {
    const sync = () => {
      setExistingReview(arxivId ? getReviewByArxivId(arxivId) : undefined);
    };
    sync();
    window.addEventListener(REVIEWS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(REVIEWS_UPDATED_EVENT, sync);
  }, [arxivId]);

  const handleSubmitArxiv = async () => {
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

  const handleSubmitLocal = async () => {
    setError(null);

    if (!selectedFile) {
      setError("Please select a PDF file");
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const uploadRes = await fetch("/api/pdf/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        const data = await uploadRes.json();
        setError(data.error || "Upload failed");
        return;
      }

      const { pdfPath, originalName } = (await uploadRes.json()) as {
        pdfPath: string;
        originalName: string;
      };

      const title = originalName.replace(/\.pdf$/i, "") || "Local PDF";
      const review = await createLocalPdfReview(pdfPath, title);
      setSelectedFile(null);
      onCreated(review.id);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "arxiv") {
      await handleSubmitArxiv();
    } else {
      await handleSubmitLocal();
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setUrl("");
      setSelectedFile(null);
      setError(null);
      setLoading(false);
      onClose();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setError(null);
  };

  const canSubmit =
    mode === "arxiv" ? url.trim().length > 0 : selectedFile !== null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Start a review</DialogTitle>
          <DialogDescription>
            {mode === "arxiv"
              ? "Paste a link to any arXiv paper."
              : "Select a PDF from your computer."}
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => { setMode("arxiv"); setError(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "arxiv"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe size={13} />
            arXiv link
          </button>
          <button
            type="button"
            onClick={() => { setMode("local"); setError(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "local"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText size={13} />
            Local PDF
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-1">
          {mode === "arxiv" ? (
            <>
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
                  You already have a review for this paper. Continue to open it,
                  or paste a different link.
                </p>
              )}
            </>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="w-full rounded-md border-2 border-dashed border-border px-4 py-6 text-center transition-colors hover:border-primary/40 hover:bg-muted/50 disabled:opacity-50"
              >
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText size={16} className="text-primary shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">
                      {selectedFile.name}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <Upload size={20} className="text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Click to select a PDF
                    </span>
                  </div>
                )}
              </button>
            </>
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
            <Button type="submit" disabled={!canSubmit || loading}>
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Loading…
                </>
              ) : mode === "arxiv" && existingReview ? (
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
