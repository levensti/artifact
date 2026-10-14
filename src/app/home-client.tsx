"use client";

import {
  ArrowUp,
  Compass,
  Globe,
  Loader2,
  Search,
  Upload,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import NewReviewDialog from "@/components/new-review-dialog";
import { MonoLabel } from "@/components/folio";
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
        className="flex h-full flex-col overflow-y-auto"
        style={{ background: "var(--reader-mat)" }}
      >
        {/* Same content column as Discover/Journal so navigating between pages
            doesn't reflow the layout. */}
        <div className="mx-auto w-full max-w-4xl px-6 pb-16 pt-12 sm:px-8 sm:pt-14">
          {/* Title mirrors the Discover/Journal PageHeader (size, weight, and
              top position) so navigating between pages doesn't shift the
              header. */}
          <h1 className="text-[27px] font-semibold leading-tight tracking-[-0.022em] text-foreground">
            Home
          </h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Open a paper to start a review. Your reviews live in the sidebar.
          </p>

          {/* Primary input: paste an arXiv link or search papers by keyword. */}
          <div className="mt-6">
            <ArxivBar onOpenReview={openReview} />
          </div>

          {/* Other ways in, as one hairline-divided strip. */}
          <div className="mt-4 grid grid-cols-1 overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-3 sm:divide-x divide-y sm:divide-y-0 divide-border">
            <QuickAction
              icon={Upload}
              title="Upload a PDF"
              detail="From your computer"
              onClick={() => setImportMode("local")}
            />
            <QuickAction
              icon={Globe}
              title="Open a web page"
              detail="Blog posts, docs, articles"
              onClick={() => setImportMode("web")}
            />
            <QuickAction
              icon={Compass}
              title="Discover papers"
              detail="Get a ranked reading list"
              onClick={() => router.push("/discover")}
            />
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

function QuickAction({
  icon: Icon,
  title,
  detail,
  onClick,
}: {
  icon: typeof Upload;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/60"
    >
      <Icon
        className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
        strokeWidth={1.75}
      />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-foreground">
          {title}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {detail}
        </span>
      </span>
    </button>
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
          "relative rounded-lg border bg-card transition-colors",
          loading
            ? "border-border/50 opacity-90"
            : "border-border focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/15",
        )}
        style={{ boxShadow: "var(--shadow-sm)" }}
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
          className="block w-full bg-transparent py-[9px] pl-11 pr-12 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          aria-label="Start review"
          title="Start review"
          className={cn(
            "absolute right-[5px] top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md transition-colors",
            canSend
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "cursor-default bg-muted text-muted-foreground/60",
          )}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowUp className="size-4" strokeWidth={2.25} />
          )}
        </button>
      </div>

      {/* Live keyword results — only while typing a non-link query. */}
      {looksLikeQuery ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-border bg-card">
          {searching && results.length === 0 ? (
            <div className="flex items-center gap-2 px-3.5 py-3">
              <Loader2
                className="size-3.5 animate-spin text-primary/70"
                strokeWidth={2}
              />
              <MonoLabel>Searching arXiv</MonoLabel>
            </div>
          ) : results.length === 0 ? (
            <div className="px-3.5 py-3 text-[12.5px] text-muted-foreground">
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
                    className="w-full px-3.5 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
                  >
                    <div className="line-clamp-2 text-[13px] font-medium leading-[1.4] tracking-[-0.005em] text-foreground">
                      {r.title}
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
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
        <p className="mt-2 pl-1 text-[12px] text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
