"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getReviewsSnapshot,
  openRecommendation,
  setRecommendationDismissed,
} from "@/lib/client-data";
import { normalizeArxivId } from "@/lib/arxiv";
import { MonoLabel } from "@/components/folio";
import type { Recommendation } from "@/lib/discover-types";

/* ------------------------------------------------------------------ */
/*  Source heuristics                                                  */
/* ------------------------------------------------------------------ */

function hostOf(url: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sourceLabel(url: string): string {
  return hostOf(url) ?? "web";
}

/**
 * Lightweight URL-derived classification for the chip. Pure heuristic —
 * good enough to communicate "academic vs not" and the rough flavor at a
 * glance. The agent isn't asked to label this; we infer.
 */
type SourceKind = "Paper" | "Blog" | "Web";

const BLOG_HOST_SUBSTRINGS = [
  "/blog",
  "medium.com",
  "substack.com",
  "hashnode.dev",
  "lilianweng",
  "jalammar",
  "thinkingmachines.ai",
  "ingonyama.com",
  "huggingface.co/blog",
  "openai.com/blog",
  "anthropic.com/news",
  "anthropic.com/research",
  "deepmind.google/discover",
  "research.google",
  "ai.meta.com/blog",
  "fast.ai",
];

function classifySource(rec: Recommendation): SourceKind {
  if (rec.arxivId) return "Paper";
  const host = hostOf(rec.url);
  if (!host) return "Web";
  if (host.endsWith(".github.io")) return "Blog";
  const haystack = (host + (() => {
    try {
      return new URL(rec.url).pathname;
    } catch {
      return "";
    }
  })()).toLowerCase();
  if (BLOG_HOST_SUBSTRINGS.some((s) => haystack.includes(s))) return "Blog";
  return "Web";
}

function authorsLabel(authors: string): string {
  const list = authors
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (list.length <= 3) return list.join(", ");
  return `${list.slice(0, 3).join(", ")} et al.`;
}

function yearLabel(rec: Recommendation): string | null {
  if (rec.publishedYear) return String(rec.publishedYear);
  return rec.publishedDate?.slice(0, 4) ?? null;
}

const KIND_STYLE: Record<SourceKind, string> = {
  Paper: "border-primary/30 bg-primary/[0.06] text-primary/85",
  Blog: "border-amber-400/30 bg-amber-400/[0.08] text-amber-700 dark:text-amber-400",
  Web: "border-border/60 bg-muted/30 text-muted-foreground",
};

/* ------------------------------------------------------------------ */
/*  Card                                                               */
/* ------------------------------------------------------------------ */

/**
 * One entry in a brief's reading list. The agent ranks the picks; rank #1
 * is surfaced as the **Top pick** — accent kicker, filled primary action —
 * so the eye lands on the single best thing to read. Lower ranks get a
 * quieter tinted action. "In library" is detected against the reviews cache
 * so a re-surfaced paper shows the badge before any click.
 */
export default function RecommendationCard({
  rec,
}: {
  rec: Recommendation;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"open" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reviews = getReviewsSnapshot();
  const inLibraryReview = rec.arxivId
    ? reviews.find(
        (r) =>
          r.arxivId &&
          rec.arxivId &&
          normalizeArxivId(r.arxivId) === normalizeArxivId(rec.arxivId),
      )
    : reviews.find((r) => r.sourceUrl === rec.url);

  const onOpen = async () => {
    if (busy) return;
    setError(null);
    if (inLibraryReview) {
      router.push(`/review/${inLibraryReview.id}`);
      return;
    }
    setBusy("open");
    try {
      const { review } = await openRecommendation(rec.id);
      router.push(`/review/${review.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open");
      setBusy(null);
    }
  };

  const onDismiss = async () => {
    if (busy) return;
    setBusy("dismiss");
    setError(null);
    try {
      await setRecommendationDismissed(rec.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss");
      setBusy(null);
    }
  };

  const kind = classifySource(rec);
  const isTop = rec.rank === 1;
  const year = yearLabel(rec);

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card px-4 py-3.5 transition-colors",
        isTop
          ? "border-primary/30 shadow-[var(--shadow-sm)] ring-1 ring-primary/10"
          : "border-border/70 hover:border-border",
      )}
    >
      {isTop ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ background: "color-mix(in srgb, var(--primary) 70%, transparent)" }}
        />
      ) : null}

      {/* Kicker: Top pick, or quiet rank */}
      <div className="mb-1.5 flex items-center gap-2">
        {isTop ? (
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3 text-primary/80" strokeWidth={2} />
            <MonoLabel tone="accent">Top pick</MonoLabel>
          </span>
        ) : rec.rank > 0 ? (
          <span
            className="font-mono text-[10.5px] font-medium tabular-nums text-muted-foreground/65"
            title="Agent's preference order"
          >
            #{rec.rank}
          </span>
        ) : null}
      </div>

      <h3
        className={cn(
          "text-[15px] font-semibold leading-snug tracking-[-0.01em] text-foreground",
        )}
      >
        {rec.title}
      </h3>

      {rec.authors ? (
        <p
          className="mt-1 truncate text-[12px] leading-snug text-foreground/60"
          title={rec.authors}
          style={{ fontFamily: "var(--font-reading)" }}
        >
          {authorsLabel(rec.authors)}
        </p>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-sm border px-1 py-px font-mono text-[10px] font-medium uppercase tracking-wider",
            KIND_STYLE[kind],
          )}
        >
          {kind}
        </span>
        <span className="font-mono">
          {rec.arxivId ? `arXiv:${rec.arxivId}` : sourceLabel(rec.url)}
        </span>
        {year ? (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono tabular-nums">{year}</span>
          </>
        ) : null}
        {inLibraryReview ? (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-0.5 font-medium text-success/85">
              <Check className="size-3" strokeWidth={2.5} />
              In library
            </span>
          </>
        ) : null}
      </div>

      {rec.rationale ? (
        <p
          className="mt-2 text-[13px] leading-relaxed text-foreground/80"
          style={{ fontFamily: "var(--font-reading)" }}
        >
          {rec.rationale}
        </p>
      ) : null}

      {/* Action row */}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          disabled={busy !== null}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors",
            isTop
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
            busy !== null && "opacity-70",
          )}
        >
          {busy === "open" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ArrowRight className="size-3.5" strokeWidth={2.25} />
          )}
          {inLibraryReview ? "Open review" : "Start review"}
        </button>

        {rec.url && !inLibraryReview ? (
          <a
            href={rec.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground/75 transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3" strokeWidth={2} />
            Source
          </a>
        ) : null}

        <span className="flex-1" />

        <button
          type="button"
          onClick={onDismiss}
          disabled={busy !== null}
          aria-label="Dismiss"
          title="Not interested"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-muted hover:text-foreground"
        >
          {busy === "dismiss" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <X className="size-3.5" strokeWidth={2} />
          )}
        </button>
      </div>

      {error ? (
        <p className="mt-1.5 text-[11px] text-destructive">{error}</p>
      ) : null}
    </article>
  );
}
