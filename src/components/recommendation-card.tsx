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
 * One row in a brief's ranked reading list. Rank #1 gets the accent rank and
 * the filled primary action so the eye lands on the single best thing to
 * read; lower ranks get a bordered one. "In library" is detected against the
 * reviews cache so a re-surfaced paper shows the badge before any click.
 * `pending` is a pick the agent has chosen but that isn't saved yet: it
 * renders identically with its actions disabled.
 */
export default function RecommendationCard({
  rec,
  pending = false,
}: {
  rec: Recommendation;
  pending?: boolean;
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
    if (busy || pending) return;
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
    if (busy || pending) return;
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
  const locked = busy !== null || pending;
  // Who, when, where: one plain line under the title.
  const meta = [
    rec.authors ? authorsLabel(rec.authors) : null,
    year,
    kind === "Paper" ? "arXiv" : sourceLabel(rec.url),
  ].filter(Boolean);

  return (
    <article className="grid grid-cols-[20px_1fr] gap-x-4 px-6 py-5">
      <span
        className={cn(
          "pt-px text-right text-[15px] font-semibold tabular-nums",
          isTop ? "text-primary" : "text-muted-foreground/70",
        )}
        title="Agent's preference order"
      >
        {rec.rank > 0 ? rec.rank : ""}
      </span>

      <div className="min-w-0">
        <h3 className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
          {rec.title}
        </h3>

        <p
          className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug text-muted-foreground"
          title={rec.authors ?? undefined}
        >
          {meta.map((part, i) => (
            <span key={i} className="inline-flex items-center gap-x-1.5">
              {i > 0 ? <span aria-hidden>·</span> : null}
              {part}
            </span>
          ))}
          {inLibraryReview ? (
            <span className="inline-flex items-center gap-1 text-success">
              <span aria-hidden className="text-muted-foreground">·</span>
              <Check className="size-3" strokeWidth={2.5} />
              In library
            </span>
          ) : null}
        </p>

        {rec.rationale ? (
          <p
            className="mt-2.5 max-w-[68ch] text-[14.5px] leading-[1.65] text-foreground/85"
            style={{ fontFamily: "var(--font-reading)" }}
          >
            {rec.rationale}
          </p>
        ) : null}

        {/* Action row */}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            disabled={locked}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:cursor-default",
              isTop
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-border bg-card text-foreground hover:bg-muted",
              locked && "opacity-60",
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
              className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="size-3" strokeWidth={2} />
              Source
            </a>
          ) : null}

          <span className="flex-1" />

          {!pending ? (
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
          ) : null}
        </div>

        {error ? (
          <p className="mt-1.5 text-[12px] text-destructive">{error}</p>
        ) : null}
      </div>
    </article>
  );
}
