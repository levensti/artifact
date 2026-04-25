"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileDown, FileText, Globe, Loader2, Search, Upload } from "lucide-react";
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
import type { ArxivSearchResult } from "@/lib/explore";

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

  // Keyword search state for arXiv mode.
  const [searchResults, setSearchResults] = useState<ArxivSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const trimmedUrl = url.trim();
  const looksLikeArxivQuery =
    trimmedUrl.length >= 3 &&
    !arxivId &&
    !/^https?:\/\//i.test(trimmedUrl) &&
    !/^\d+\.\d+(v\d+)?$/.test(trimmedUrl);

  useEffect(() => {
    const sync = () => {
      setExistingReview(arxivId ? getReviewByArxivId(arxivId) : undefined);
    };
    sync();
    window.addEventListener(REVIEWS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(REVIEWS_UPDATED_EVENT, sync);
  }, [arxivId]);

  useEffect(() => {
    if (mode !== "arxiv" || !looksLikeArxivQuery) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/arxiv-search?query=${encodeURIComponent(trimmedUrl)}&max_results=8`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          setSearchResults([]);
          return;
        }
        const data: { results?: ArxivSearchResult[] } = await res.json();
        setSearchResults(data.results ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [mode, looksLikeArxivQuery, trimmedUrl]);

  const handleSelectSearchResult = async (result: ArxivSearchResult) => {
    setError(null);
    setLoading(true);
    try {
      const review = await createOrGetReview(result.arxivId, result.title);
      setUrl("");
      setSearchResults([]);
      onCreated(review.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start review");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitArxiv = async () => {
    setError(null);

    if (!trimmedUrl) {
      setError("Paste a link or search by keywords");
      return;
    }

    // If the input is a search query, pick the top result on Enter.
    if (looksLikeArxivQuery) {
      if (searchResults.length > 0) {
        await handleSelectSearchResult(searchResults[0]);
      }
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
      setSearchResults([]);
      setSearching(false);
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
      ? Boolean(arxivId) ||
        (looksLikeArxivQuery && searchResults.length > 0)
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
              ? "Paste a link or search arXiv by keywords."
              : mode === "web"
                ? "Paste a link to any web page."
                : mode === "import"
                  ? "Open a review someone shared with you."
                  : "Select a PDF from your computer."}
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle */}
        {(() => {
          const modes = ["arxiv", "local", "web", "import"] as const;
          const activeIndex = modes.indexOf(mode);
          return (
            <div className="relative flex gap-0.5 rounded-xl bg-muted/70 p-1 border border-border/40">
              {/* Sliding pill */}
              <div
                className="absolute top-1 bottom-1 rounded-lg bg-background shadow-md ring-1 ring-border/50 transition-all duration-200 ease-out"
                style={{
                  width: "calc((100% - 8px) / 4)",
                  left: `calc(4px + ${activeIndex} * (100% - 8px) / 4)`,
                }}
              />
              {modes.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(null); }}
                  className={`relative z-10 flex-1 min-w-0 flex items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    mode === m
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "local" ? (
                    <FileText size={13} className="shrink-0" />
                  ) : m === "import" ? (
                    <FileDown size={13} className="shrink-0" />
                  ) : (
                    <Globe size={13} className="shrink-0" />
                  )}
                  {m === "arxiv" ? "arXiv" : m === "web" ? "Web" : m === "local" ? "PDF" : "Import"}
                </button>
              ))}
            </div>
          );
        })()}

        {mode === "import" ? (
          <div className="mt-4 border-t border-border/40 pt-4">
            <div className="h-[68px] flex items-center">
              <button
                type="button"
                onClick={() => {
                  handleOpenChange(false);
                  onImport?.();
                }}
                className="w-full h-full rounded-xl border-2 border-dashed border-border px-4 text-center transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.03] hover:shadow-sm flex items-center justify-center gap-2"
              >
                <FileDown size={16} className="text-muted-foreground shrink-0" />
                <span className="text-sm text-muted-foreground">
                  Open a shared review file
                </span>
              </button>
            </div>
            <DialogFooter className="mt-4 border-t border-border/40 pt-4">
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
        <form onSubmit={handleSubmit} className="mt-4 border-t border-border/40 pt-4">
          {/* Fixed-height primary input area — keeps footer stable across tabs */}
          <div className="h-[68px] flex items-center">
            {mode === "arxiv" ? (
              <div className="relative w-full">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <Input
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError(null);
                  }}
                  placeholder="Paste a link or search by keywords"
                  autoFocus
                  disabled={loading}
                  className="pl-8"
                />
              </div>
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
                className="w-full"
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
                  className="w-full h-full rounded-xl border-2 border-dashed border-border px-4 text-center transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.03] hover:shadow-sm disabled:opacity-50 flex items-center justify-center"
                >
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileText size={16} className="text-primary shrink-0" />
                      <span className="text-sm font-medium text-foreground truncate">
                        {selectedFile.name}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Upload size={16} className="text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Click to select a PDF
                      </span>
                    </div>
                  )}
                </button>
              </>
            )}
          </div>

          {/* Expandable extras (arXiv search results, errors) */}
          {mode === "arxiv" && arxivId && existingReview && (
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              You already have a review for this paper. Continue to open it,
              or paste a different link.
            </p>
          )}
          {mode === "arxiv" && looksLikeArxivQuery && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border/40 bg-muted/30">
              {searching && searchResults.length === 0 ? (
                <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Searching arXiv…
                </div>
              ) : searchResults.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No papers found. Try different keywords.
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {searchResults.map((r) => (
                    <li key={r.arxivId}>
                      <button
                        type="button"
                        onClick={() => handleSelectSearchResult(r)}
                        disabled={loading}
                        className="w-full px-3 py-2 text-left transition-colors hover:bg-background disabled:opacity-50"
                      >
                        <div className="text-xs font-medium text-foreground line-clamp-2">
                          {r.title}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
                          {r.authors.slice(0, 3).join(", ")}
                          {r.authors.length > 3 ? " et al." : ""}
                          {r.publishedDate ? ` · ${r.publishedDate.slice(0, 4)}` : ""}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}

          <DialogFooter className="mt-4 border-t border-border/40 pt-4">
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
