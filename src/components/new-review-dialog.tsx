"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  FileText,
  Globe,
  Loader2,
  Search,
  Upload,
} from "lucide-react";
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
import { ItalicAccent, MonoLabel } from "@/components/folio";
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

type SourceMode = "arxiv" | "local" | "web";

interface NewReviewDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (reviewId: string) => void;
  /** Tab to open in. Lets callers deep-link straight to PDF/web import. */
  initialMode?: SourceMode;
}

export default function NewReviewDialog({
  open,
  onClose,
  onCreated,
  initialMode = "arxiv",
}: NewReviewDialogProps) {
  const [mode, setMode] = useState<SourceMode>(initialMode);

  // Re-sync the tab each time the dialog opens, so opening it from a specific
  // affordance ("upload a PDF") lands on the matching tab.
  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);
  const [url, setUrl] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);

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
      ? Boolean(arxivId) || (looksLikeArxivQuery && searchResults.length > 0)
      : mode === "web"
        ? webUrl.trim().length > 0
        : selectedFile !== null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-2">
          <MonoLabel>New review</MonoLabel>
          <DialogTitle
            className="text-[22px] font-semibold leading-[1.15] tracking-[-0.022em]"
            style={{ textWrap: "balance" }}
          >
            Pick something to <ItalicAccent>dive deep</ItalicAccent> on.
          </DialogTitle>
          <DialogDescription
            className="text-[13.5px] leading-[1.55]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
            }}
          >
            {mode === "arxiv"
              ? "Paste an arXiv link, or search by keywords."
              : mode === "web"
                ? "Paste a link to any web page or blog post."
                : "Select a PDF from your computer."}
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle */}
        {(() => {
          const modes = ["arxiv", "local", "web"] as const;
          const activeIndex = modes.indexOf(mode);
          return (
            <div
              className="relative flex gap-0.5 rounded-md border p-1"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--border) 70%, transparent)",
                background:
                  "color-mix(in srgb, var(--reader-mat) 60%, var(--background))",
              }}
            >
              {/* Sliding pill */}
              <div
                className="absolute top-1 bottom-1 rounded transition-all duration-200 ease-out"
                style={{
                  width: "calc((100% - 8px) / 3)",
                  left: `calc(4px + ${activeIndex} * (100% - 8px) / 3)`,
                  background: "var(--background)",
                  border:
                    "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
                  boxShadow: "var(--shadow-sm)",
                }}
              />
              {modes.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setError(null);
                  }}
                  className={`relative z-10 flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-1.5 py-1.5 text-[12px] font-medium transition-colors ${
                    mode === m
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-pressed={mode === m}
                >
                  {m === "local" ? (
                    <FileText
                      size={12}
                      className="shrink-0"
                      strokeWidth={1.8}
                    />
                  ) : (
                    <Globe size={12} className="shrink-0" strokeWidth={1.8} />
                  )}
                  {m === "arxiv" ? "arXiv" : m === "web" ? "Web" : "PDF"}
                </button>
              ))}
            </div>
          );
        })()}

        <form
          onSubmit={handleSubmit}
          className="mt-4 border-t border-border/40 pt-4"
        >
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
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!loading) setIsDraggingPdf(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
                      if (!loading && !isDraggingPdf) setIsDraggingPdf(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (
                        e.currentTarget.contains(e.relatedTarget as Node | null)
                      )
                        return;
                      setIsDraggingPdf(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsDraggingPdf(false);
                      if (loading) return;
                      const file = e.dataTransfer?.files?.[0];
                      if (!file) return;
                      if (!file.name.toLowerCase().endsWith(".pdf")) {
                        setError("Only .pdf files are supported");
                        return;
                      }
                      setSelectedFile(file);
                      setError(null);
                    }}
                    className={`flex h-full w-full items-center justify-center rounded-md border border-dashed px-4 text-center transition-colors duration-150 disabled:opacity-50 ${
                      isDraggingPdf
                        ? "bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]"
                        : "hover:bg-[color-mix(in_srgb,var(--primary)_3%,transparent)]"
                    }`}
                    style={{
                      borderColor: isDraggingPdf
                        ? "color-mix(in srgb, var(--primary) 45%, transparent)"
                        : "color-mix(in srgb, var(--border) 80%, transparent)",
                    }}
                  >
                    {selectedFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileText
                          size={15}
                          className="shrink-0"
                          strokeWidth={1.8}
                          style={{
                            color:
                              "color-mix(in srgb, var(--primary) 75%, transparent)",
                          }}
                        />
                        <span className="truncate text-[13px] font-medium text-foreground">
                          {selectedFile.name}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Upload
                          size={15}
                          strokeWidth={1.8}
                          style={{
                            color:
                              "color-mix(in srgb, var(--primary) 70%, transparent)",
                          }}
                        />
                        <span
                          className="text-[13px]"
                          style={{
                            fontFamily: "var(--font-reading)",
                            color:
                              "color-mix(in srgb, var(--foreground) 72%, transparent)",
                          }}
                        >
                          Click to select a PDF, or drop one here
                        </span>
                      </div>
                    )}
                  </button>
                </>
              )}
            </div>

            {/* Expandable extras (arXiv search results, errors) */}
            {mode === "arxiv" && arxivId && existingReview && (
              <p
                className="mt-2 text-[12px] leading-[1.55]"
                style={{
                  fontFamily: "var(--font-reading)",
                  color:
                    "color-mix(in srgb, var(--foreground) 70%, transparent)",
                }}
              >
                You already have a review for this paper. Continue to open it,
                or paste a different link.
              </p>
            )}
            {mode === "arxiv" && looksLikeArxivQuery && (
              <div
                className="mt-2 max-h-64 overflow-y-auto rounded-md border bg-card"
                style={{
                  borderColor:
                    "color-mix(in srgb, var(--border) 70%, transparent)",
                }}
              >
                {searching && searchResults.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 px-3 py-4">
                    <Loader2
                      className="size-3.5 animate-spin"
                      strokeWidth={2}
                      style={{
                        color:
                          "color-mix(in srgb, var(--primary) 70%, transparent)",
                      }}
                    />
                    <span
                      className="font-mono text-[10.5px] uppercase"
                      style={{
                        letterSpacing: "0.16em",
                        color:
                          "color-mix(in srgb, var(--muted-foreground) 80%, transparent)",
                      }}
                    >
                      Searching arXiv
                    </span>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div
                    className="px-3 py-4 text-center text-[12px]"
                    style={{
                      fontFamily: "var(--font-reading)",
                      color:
                        "color-mix(in srgb, var(--muted-foreground) 90%, transparent)",
                    }}
                  >
                    No papers found. Try different keywords.
                  </div>
                ) : (
                  <ul
                    className="divide-y"
                    style={{
                      borderColor:
                        "color-mix(in srgb, var(--border) 50%, transparent)",
                    }}
                  >
                    {searchResults.map((r) => (
                      <li
                        key={r.arxivId}
                        className="border-b last:border-b-0"
                        style={{
                          borderColor:
                            "color-mix(in srgb, var(--border) 50%, transparent)",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectSearchResult(r)}
                          disabled={loading}
                          className="block w-full px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--badge-accent-bg)] disabled:opacity-50"
                        >
                          <div className="line-clamp-2 text-[12.5px] font-semibold leading-[1.4] tracking-[-0.005em] text-foreground">
                            {r.title}
                          </div>
                          <div
                            className="mt-1 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2 text-[11px] leading-none"
                            style={{
                              fontFamily: "var(--font-reading)",
                              color:
                                "color-mix(in srgb, var(--muted-foreground) 90%, transparent)",
                            }}
                          >
                            <span className="font-mono text-[10px] tabular-nums leading-none">
                              arXiv:{r.arxivId}
                            </span>
                            <span className="min-w-0 truncate leading-none">
                              {r.authors.slice(0, 3).join(", ")}
                              {r.authors.length > 3 ? " et al." : ""}
                              {r.publishedDate
                                ? ` · ${r.publishedDate.slice(0, 4)}`
                                : ""}
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {error && (
              <p
                className="mt-2 text-[12px]"
                style={{
                  fontFamily: "var(--font-reading)",
                  color: "var(--destructive)",
                }}
              >
                {error}
              </p>
            )}

            <DialogFooter className="mt-4 border-t border-border/40 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!canSubmit || loading}
                className="group h-9 gap-1.5 px-4 text-[13px] font-medium shadow-[var(--shadow-primary)] transition-all duration-150 hover:bg-primary/90 active:translate-y-px disabled:shadow-none"
              >
                {loading ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                    {mode === "arxiv" && existingReview
                      ? "Opening…"
                      : "Starting…"}
                  </>
                ) : mode === "arxiv" && existingReview ? (
                  <>
                    Open review
                    <ArrowRight
                      className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
                      strokeWidth={2}
                    />
                  </>
                ) : (
                  <>
                    Start review
                    <ArrowRight
                      className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
                      strokeWidth={2}
                    />
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
      </DialogContent>
    </Dialog>
  );
}
