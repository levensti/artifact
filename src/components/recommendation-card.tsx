"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Compass,
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
import { JUDGE_DIMENSIONS } from "@/lib/judge-rubric";
import InlineMarkdown from "./inline-markdown";

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

/** Hover text for the rank: the judge's breakdown, or that the order is
 *  the research agent's own when the pick hasn't been judged. */
function rankTitle(rec: Recommendation): string {
  if (rec.judgeScore === null || !rec.judgeDetail) {
    return "Research agent's order (not yet judged)";
  }
  const lines = JUDGE_DIMENSIONS.flatMap((d) => {
    const r = rec.judgeDetail?.dimensions[d.id];
    if (!r) return [];
    const top = d.criteria.length - 1;
    const label = d.id.charAt(0).toUpperCase() + d.id.slice(1);
    return [`${label}: ${r.score.toFixed(1)} / ${top}`];
  });
  return [
    `Judge score: ${Math.round(rec.judgeScore * 100)} / 100`,
    ...lines,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/*  Card                                                               */
/* ------------------------------------------------------------------ */

/**
 * One entry in a brief's ranked reading list: rank, title, and the action to
 * start reading, then who wrote it and why it's here (clamped to two lines).
 * Rank #1 gets the accent rank and the filled primary action so the eye
 * lands on the single best thing to read; lower ranks get a bordered one. "In library" is detected against the
 * reviews cache so a re-surfaced paper shows the badge before any click.
 * In a project's combined list, `rank` overrides the pick's own position and
 * `origin` links back to the research session it came from.
 */
export default function RecommendationCard({
  rec,
  rank,
  origin,
}: {
  rec: Recommendation;
  /** Position to show instead of `rec.rank`. */
  rank?: number;
  /** The session this pick came from, shown as a link. */
  origin?: { label: string; onOpen: () => void };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"open" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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
  const shownRank = rank ?? rec.rank;
  const isTop = shownRank === 1;
  const year = yearLabel(rec);
  const locked = busy !== null;
  // Who, when, where: one plain line under the title.
  const meta = [
    rec.authors ? authorsLabel(rec.authors) : null,
    year,
    kind === "Paper" ? "arXiv" : sourceLabel(rec.url),
  ].filter(Boolean);

  const longRationale = (rec.rationale?.length ?? 0) > 200;
  // Secondary actions stay out of the way until the row is hovered or
  // focused; on touch screens (no hover) they're always shown.
  const quiet =
    "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

  return (
    <article className="group grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 py-4">
      <span
        className={cn(
          "pt-[2px] text-right text-[14px] font-semibold tabular-nums",
          isTop ? "text-primary" : "text-muted-foreground/70",
        )}
        title={rankTitle(rec)}
      >
        {shownRank > 0 ? shownRank : ""}
      </span>

      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <h3 className="min-w-0 flex-1 text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
            {rec.title}
          </h3>
          <div className="-mt-0.5 flex shrink-0 items-center gap-0.5">
            {rec.url && !inLibraryReview ? (
              <a
                href={rec.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open the source"
                title="Open the source"
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  quiet,
                )}
              >
                <ExternalLink className="size-3.5" strokeWidth={2} />
              </a>
            ) : null}
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy !== null}
              aria-label="Dismiss"
              title="Not interested"
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground",
                quiet,
              )}
            >
              {busy === "dismiss" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <X className="size-3.5" strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              onClick={onOpen}
              disabled={locked}
              className={cn(
                "ml-1 inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors disabled:cursor-default",
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
          </div>
        </div>

        <p
          className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug text-muted-foreground"
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
          <div className="mt-2 max-w-[68ch]">
            <InlineMarkdown
              content={rec.rationale}
              className={cn(
                "text-[14px] leading-[1.6] text-foreground/80 [font-family:var(--font-reading)]",
                longRationale && !expanded && "line-clamp-2",
              )}
            />
            {longRationale ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-0.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {expanded ? "Less" : "More"}
              </button>
            ) : null}
          </div>
        ) : null}

        {origin ? (
          <button
            type="button"
            onClick={origin.onOpen}
            title={`Open the research session: ${origin.label}`}
            className="-ml-1.5 mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <Compass className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{origin.label}</span>
          </button>
        ) : null}

        {error ? (
          <p className="mt-1.5 text-[12px] text-destructive">{error}</p>
        ) : null}
      </div>
    </article>
  );
}
