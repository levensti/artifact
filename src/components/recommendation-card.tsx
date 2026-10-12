"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getReviewsSnapshot,
  openRecommendation,
  setRecommendationDismissed,
} from "@/lib/client-data";
import { normalizeArxivId } from "@/lib/arxiv";
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

/* ------------------------------------------------------------------ */
/*  Card                                                               */
/* ------------------------------------------------------------------ */

/**
 * One row in a brief's ranked reading list (rendered inside the list's
 * hairline-divided panel, the same anatomy as the landing's Discover feed).
 * Rank #1 gets the accent rank and the filled primary action so the eye
 * lands on the single best thing to read; lower ranks get a bordered one. "In library" is detected against the reviews cache
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
    <article className="grid grid-cols-[28px_1fr] gap-x-3 px-4 py-4">
      <span
        className={cn(
          "pt-0.5 font-mono text-[11.5px] tabular-nums",
          isTop ? "text-primary" : "text-muted-foreground",
        )}
        title="Agent's preference order"
      >
        {rec.rank > 0 ? String(rec.rank).padStart(2, "0") : "·"}
      </span>

      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
          {rec.title}
        </h3>

        {rec.authors ? (
          <p
            className="mt-0.5 truncate text-[12.5px] leading-snug text-muted-foreground"
            title={rec.authors}
          >
            {authorsLabel(rec.authors)}
          </p>
        ) : null}

        {rec.rationale ? (
          <p
            className="mt-1.5 text-[13.5px] leading-relaxed text-foreground/85"
            style={{ fontFamily: "var(--font-reading)" }}
          >
            {rec.rationale}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
          <span>{kind}</span>
          <span aria-hidden>·</span>
          <span>{rec.arxivId ? `arXiv:${rec.arxivId}` : sourceLabel(rec.url)}</span>
          {year ? (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{year}</span>
            </>
          ) : null}
          {inLibraryReview ? (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5 text-success">
                <Check className="size-3" strokeWidth={2.5} />
                In library
              </span>
            </>
          ) : null}
        </div>

        {/* Action row */}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            disabled={busy !== null}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors",
              isTop
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-border bg-card text-foreground hover:bg-muted",
              busy !== null && "opacity-70",
            )}
          >
            {busy === "open" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowRight className="size-3.5" strokeWidth={2} />
            )}
            {inLibraryReview ? "Open review" : "Start review"}
          </button>

          {rec.url && !inLibraryReview ? (
            <a
              href={rec.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
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
      </div>
    </article>
  );
}
