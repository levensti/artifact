"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileDown, FileText, Globe, Loader2, Upload } from "lucide-react";
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
  createWebReview,
  getReviewByArxivId,
  REVIEWS_UPDATED_EVENT,
  type PaperReview,
} from "@/lib/reviews";
import { savePdfBlob } from "@/lib/client/pdf-blobs";
import { extractArxivId } from "@/lib/utils";

type SourceMode = "arxiv" | "local" | "web" | "import";

interface NewReviewDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (reviewId: string) => void;
  onImport?: () => void;
}

export default function NewReviewDialog({
  open,
  onClose,
  onCreated,
  onImport,
}: NewReviewDialogProps) {
  const [mode, setMode] = useState<SourceMode>("arxiv");
  const [url, setUrl] = useState("");
  const [webUrl, setWebUrl] = useState("");
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

    if (!selectedFile.name.toLowerCase().endsWith(".pdf")) {
      setError("Only .pdf files are supported");
      return;
    }

    setLoading(true);
    try {
      const pdfPath = await savePdfBlob(selectedFile);
      const title = selectedFile.name.replace(/\.pdf$/i, "") || "Local PDF";
      const review = await createLocalPdfReview(pdfPath, title);
      setSelectedFile(null);
      onCreated(review.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save PDF");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitWeb = async () => {
    setError(null);

    const trimmed = webUrl.trim();
    if (!trimmed) {
      setError("Please enter a URL");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setError("Enter a valid URL (e.g. https://example.com/article)");
      return;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      setError("Only http and https URLs are supported");
      return;
    }

    setLoading(true);
    try {
      // Fetch page metadata to get the title
      let pageTitle = parsed.hostname;
      try {
        const res = await fetch(
          `/api/web-content?url=${encodeURIComponent(trimmed)}`,
        );
        if (res.ok) {
          const data: { title?: string } = await res.json();
          if (typeof data.title === "string" && data.title.trim()) {
            pageTitle = data.title.trim();
          }
        } else {
          const data = await res
            .json()
            .catch(() => ({ error: "Failed to fetch" }));
          setError(data.error || "Could not load this page");
          return;
        }
      } catch {
        /* keep fallback title */
      }

      const review = await createWebReview(trimmed, pageTitle);
      setWebUrl("");
      onCreated(review.id);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "arxiv") {
      await handleSubmitArxiv();
    } else if (mode === "web") {
      await handleSubmitWeb();
    } else {
      await handleSubmitLocal();
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setUrl("");
      setWebUrl("");
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
    mode === "arxiv"
      ? url.trim().length > 0
      : mode === "web"
        ? webUrl.trim().length > 0
        : selectedFile !== null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a review session</DialogTitle>
          <DialogDescription>
            {mode === "arxiv"
              ? "Paste a link to any arXiv paper."
              : mode === "web"
                ? "Paste a link to any web page."
                : mode === "import"
                  ? "Open a review someone shared with you."
                  : "Select a PDF from your computer."}
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="relative flex gap-0.5 rounded-xl bg-muted/70 p-1 border border-border/40">
          {/* Sliding pill */}
          <div
            className="absolute top-1 bottom-1 rounded-lg bg-background shadow-md ring-1 ring-border/50 transition-all duration-200 ease-out"
            style={{
              width: "calc((100% - 8px) / 4)",
              left: mode === "arxiv"
                ? "4px"
                : mode === "web"
                  ? "calc(4px + (100% - 8px) / 4)"
                  : mode === "local"
                    ? "calc(4px + 2 * (100% - 8px) / 4)"
                    : "calc(4px + 3 * (100% - 8px) / 4)",
            }}
          />
          {(["arxiv", "web", "local", "import"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); }}
              className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
                mode === m
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "local" ? <FileText size={13} /> : m === "import" ? <FileDown size={13} /> : <Globe size={13} />}
              {m === "arxiv" ? "arXiv" : m === "web" ? "Web URL" : m === "local" ? "PDF" : "Import"}
            </button>
          ))}
        </div>

        {mode === "import" ? (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => {
                handleOpenChange(false);
                onImport?.();
              }}
              className="w-full rounded-xl border-2 border-dashed border-border px-4 py-8 text-center transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.03] hover:shadow-sm"
            >
              <div className="flex flex-col items-center gap-1.5">
                <FileDown size={20} className="text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Open a shared review file
                </span>
                <span className="text-[11px] text-muted-foreground/50">
                  review-*.json
                </span>
              </div>
            </button>
            <DialogFooter className="mt-5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </div>
        ) : (
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
          ) : mode === "web" ? (
            <Input
              value={webUrl}
              onChange={(e) => {
                setWebUrl(e.target.value);
                setError(null);
              }}
              placeholder="https://example.com/article"
              autoFocus
              disabled={loading}
            />
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
                className="w-full rounded-xl border-2 border-dashed border-border px-4 py-8 text-center transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.03] hover:shadow-sm disabled:opacity-50"
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
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading…
                </>
              ) : mode === "arxiv" && existingReview ? (
                <>
                  Open review
                  <ArrowRight className="size-3.5" />
                </>
              ) : (
                <>
                  Start review
                  <ArrowRight className="size-3.5" />
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
