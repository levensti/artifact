"use client";

import { ArrowUp, Globe, Loader2, Search, Upload } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import NewReviewDialog from "@/components/new-review-dialog";
import { ItalicAccent, MonoLabel } from "@/components/folio";
import { createOrGetReview, getReviewByArxivId } from "@/lib/reviews";
import { cn, extractArxivId } from "@/lib/utils";
import type { ArxivSearchResult } from "@/lib/explore";
import { useRouter } from "next/navigation";

/** The importer modes a secondary action can deep-link into. */
type ImportMode = "local" | "web";

export default function HomeClient() {
  // SettingsOpenerProvider is mounted *inside* DashboardLayout, so any hook
  // that touches that context (useSettingsOpener) has to live in a child
  // component rendered as a descendant. Splitting the body keeps the hook
  // call below the provider in the React tree.
  return (
    <DashboardLayout>
      <HomeBody />
    </DashboardLayout>
  );
}

function HomeBody() {
  // null = dialog closed; otherwise the importer mode to open it in.
  const [importMode, setImportMode] = useState<ImportMode | null>(null);
  const router = useRouter();

  const openReview = useCallback(
    (id: string) => router.push(`/review/${id}`),
    [router],
  );

  return (
    <>
      <div
        className="relative flex h-full flex-col overflow-y-auto"
        style={{ background: "var(--reader-mat)" }}
      >
        {/* Ambient watermark — the Artifact mark at large scale */}
        <svg
          viewBox="4 4 24 24"
          aria-hidden
          className="pointer-events-none absolute right-[8%] top-[12%] size-80 opacity-[0.025]"
        >
          <polygon
            points="5,24 12,7 19,24"
            fill="currentColor"
            opacity="0.55"
          />
          <polygon points="13,24 20,12 27,24" fill="currentColor" />
        </svg>

        {/* Same content column as Discover/Journal so navigating between pages
            doesn't reflow the layout. */}
        <div className="mx-auto w-full max-w-4xl px-6 pb-16 pt-12 sm:px-8 sm:pt-14">
          {/* Title mirrors the Discover/Journal PageHeader (size, weight, and
              top position) so navigating between pages doesn't shift the
              header. */}
          <h1
            className="text-[27px] font-semibold leading-tight tracking-[-0.022em] text-foreground"
            style={{ textWrap: "balance" }}
          >
            What would you like to explore <ItalicAccent>today?</ItalicAccent>
          </h1>

          {/* Primary input: paste an arXiv link or search papers by keyword. */}
          <div className="mt-6">
            <ArxivBar onOpenReview={openReview} />
            <div
              className="mt-3 flex flex-wrap items-center gap-x-0.5 gap-y-1 pl-0.5 text-[13px]"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              <span className="pr-1 text-muted-foreground/60">or</span>
              <SecondaryAction
                icon={Upload}
                label="upload a PDF"
                onClick={() => setImportMode("local")}
              />
              <span className="text-muted-foreground/35">·</span>
              <SecondaryAction
                icon={Globe}
                label="open a web page"
                onClick={() => setImportMode("web")}
              />
            </div>
          </div>
        </div>
      </div>

      <NewReviewDialog
        open={importMode !== null}
        initialMode={importMode ?? "arxiv"}
        onClose={() => setImportMode(null)}
        onCreated={(id) => {
          setImportMode(null);
          openReview(id);
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  ArxivBar — the home prompt: paste a link or search by keyword      */
/* ------------------------------------------------------------------ */

function ArxivBar({ onOpenReview }: { onOpenReview: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArxivSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = query.trim();
  const arxivId = extractArxivId(query);
  // A bare keyword query (not a link, not a raw id) → live keyword search.
  const looksLikeQuery =
    trimmed.length >= 3 &&
    !arxivId &&
    !/^https?:\/\//i.test(trimmed) &&
    !/^\d+\.\d+(v\d+)?$/.test(trimmed);

  // Debounced keyword search, mirroring the importer dialog.
  useEffect(() => {
    if (!looksLikeQuery) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/arxiv-search?query=${encodeURIComponent(trimmed)}&max_results=6`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data: { results?: ArxivSearchResult[] } = await res.json();
        setResults(data.results ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [looksLikeQuery, trimmed]);

  const startReview = useCallback(
    async (id: string, title: string) => {
      setLoading(true);
      setError(null);
      try {
        const review = await createOrGetReview(id, title);
        onOpenReview(review.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start review");
        setLoading(false);
      }
    },
    [onOpenReview],
  );

  const submit = useCallback(async () => {
    setError(null);
    if (!trimmed || loading) return;

    // Keyword query → open the top result on Enter/submit.
    if (looksLikeQuery) {
      if (results.length > 0)
        void startReview(results[0].arxivId, results[0].title);
      return;
    }

    if (!arxivId) {
      setError("Paste a valid arXiv link, or type keywords to search.");
      return;
    }

    // Already in the library — just open it.
    const existing = getReviewByArxivId(arxivId);
    if (existing) {
      onOpenReview(existing.id);
      return;
    }

    // Resolve a human title before creating, falling back to the bare id.
    setLoading(true);
    let title = `arXiv:${arxivId}`;
    try {
      const res = await fetch(
        `/api/arxiv-metadata?id=${encodeURIComponent(arxivId)}`,
      );
      if (res.ok) {
        const data: { title?: string | null } = await res.json();
        if (typeof data.title === "string" && data.title.trim()) {
          title = data.title.trim();
        }
      }
    } catch {
      /* keep fallback title */
    }
    void startReview(arxivId, title);
  }, [
    trimmed,
    loading,
    looksLikeQuery,
    results,
    arxivId,
    onOpenReview,
    startReview,
  ]);

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  const canSend = !loading && trimmed.length > 0;

  return (
    <div>
      <div
        className={cn(
          "relative rounded-2xl border bg-card transition-colors",
          loading
            ? "border-border/50 opacity-90"
            : "border-input focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10",
        )}
        style={{
          boxShadow:
            "0 1px 0 rgb(0 0 0 / 0.03), 0 12px 28px -18px rgb(0 0 0 / 0.25)",
        }}
      >
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/55"
          strokeWidth={2}
        />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          onKeyDown={onKey}
          placeholder="Paste an arXiv link, or search papers by keyword"
          disabled={loading}
          autoFocus
          className="block w-full bg-transparent py-3.5 pl-11 pr-12 text-[16px] leading-normal text-foreground placeholder:text-muted-foreground/55 focus:outline-none disabled:cursor-not-allowed"
          style={{ fontFamily: "var(--font-reading)" }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          aria-label="Start review"
          title="Start review"
          className={cn(
            "absolute right-2.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors",
            canSend
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "cursor-default text-muted-foreground/40",
          )}
          style={canSend ? undefined : { background: "var(--muted)" }}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowUp className="size-4" strokeWidth={2.5} />
          )}
        </button>
      </div>

      {/* Live keyword results — only while typing a non-link query. */}
      {looksLikeQuery ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-border/70 bg-card">
          {searching && results.length === 0 ? (
            <div className="flex items-center gap-2 px-3.5 py-3">
              <Loader2
                className="size-3.5 animate-spin text-primary/70"
                strokeWidth={2}
              />
              <MonoLabel>Searching arXiv</MonoLabel>
            </div>
          ) : results.length === 0 ? (
            <div
              className="px-3.5 py-3 text-[12.5px] text-muted-foreground"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              No papers found. Try different keywords.
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {results.map((r) => (
                <li key={r.arxivId}>
                  <button
                    type="button"
                    onClick={() => void startReview(r.arxivId, r.title)}
                    disabled={loading}
                    className="w-full px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--badge-accent-bg)] disabled:opacity-50"
                  >
                    <div className="line-clamp-2 text-[13px] font-semibold leading-[1.4] tracking-[-0.005em] text-foreground">
                      {r.title}
                    </div>
                    <div
                      className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground"
                      style={{ fontFamily: "var(--font-reading)" }}
                    >
                      {r.authors.slice(0, 3).join(", ")}
                      {r.authors.length > 3 ? " et al." : ""}
                      {r.publishedDate
                        ? ` · ${r.publishedDate.slice(0, 4)}`
                        : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {error ? (
        <p
          className="mt-2 pl-1 text-[12px] text-destructive"
          style={{ fontFamily: "var(--font-reading)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SecondaryAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Upload;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
    >
      <Icon className="size-3.5" strokeWidth={1.8} />
      {label}
    </button>
  );
}

