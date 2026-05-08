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
 *
 * - "Paper": arXiv URLs (or anything with an arxivId set).
 * - "Blog": known blog hosts and `*.github.io` / `*.substack.com` patterns.
 * - "Web": everything else.
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

const KIND_STYLE: Record<SourceKind, string> = {
  Paper:
    "border-primary/30 bg-primary/[0.06] text-primary/85",
  Blog: "border-amber-400/30 bg-amber-400/[0.08] text-amber-700 dark:text-amber-400",
  Web: "border-border/60 bg-muted/30 text-muted-foreground",
};

/* ------------------------------------------------------------------ */
/*  Card                                                               */
/* ------------------------------------------------------------------ */

/**
 * A single queue item. The fast action — Start review (creates the
 * review with fromRecommendationId set, then navigates) — is the primary
 * affordance. Dismiss collapses to an icon-only button; Source drops
 * to a tertiary text link to keep the action column tight.
 *
 * "In library" detection is by arxivId (or sourceUrl for web picks)
 * against the reviews cache so a paper re-surfaced in a later query
 * already shows the badge before the user clicks anything.
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

  return (
    <article className="rounded-lg border border-border/70 bg-card/60 px-3 py-2.5 transition-colors hover:border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {rec.rank > 0 ? (
              <span
                className="shrink-0 font-mono text-[10.5px] font-medium tabular-nums text-muted-foreground/70"
                title="Agent's preference order"
              >
                #{rec.rank}
              </span>
            ) : null}
            <h3 className="min-w-0 text-[13px] font-semibold leading-snug text-foreground">
              {rec.title}
            </h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
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
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground/85">
              {rec.rationale}
            </p>
          ) : null}
          {rec.url && !inLibraryReview ? (
            <a
              href={rec.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-2.5" strokeWidth={2} />
              Source
            </a>
          ) : null}
          {error ? (
            <p className="mt-1.5 text-[11px] text-destructive">{error}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-start gap-1.5">
          <button
            type="button"
            onClick={onOpen}
            disabled={busy !== null}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15",
              busy !== null && "opacity-70",
            )}
          >
            {busy === "open" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ArrowRight className="size-3" strokeWidth={2.25} />
            )}
            {inLibraryReview ? "Open review" : "Start review"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy !== null}
            aria-label="Dismiss"
            title="Dismiss"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
          >
            {busy === "dismiss" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <X className="size-3.5" strokeWidth={2} />
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
