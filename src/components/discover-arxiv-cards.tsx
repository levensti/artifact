"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Plus, Loader2 } from "lucide-react";
import { createOrGetReview, getReviewByArxivId } from "@/lib/reviews";
import { normalizeArxivId } from "@/lib/arxiv";
import { cn } from "@/lib/utils";
import {
  parseArxivSearchOutput,
  type PaperMeta,
} from "@/lib/discover-paper-metadata";

/* ------------------------------------------------------------------ */
/*  AddButton                                                          */
/* ------------------------------------------------------------------ */

type AddState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; reviewId: string }
  | { status: "error"; message: string };

function AddToLibraryButton({
  arxivId,
  title,
}: {
  arxivId: string;
  title: string;
}) {
  const router = useRouter();
  // Treat an existing review for this arXiv id as "already saved" — keeps
  // the button idempotent across reloads of the discover transcript.
  const [state, setState] = useState<AddState>(() => {
    const existing = getReviewByArxivId(arxivId);
    return existing
      ? { status: "saved", reviewId: existing.id }
      : { status: "idle" };
  });

  const onClick = useCallback(async () => {
    if (state.status === "saving") return;
    if (state.status === "saved") {
      router.push(`/review/${state.reviewId}`);
      return;
    }
    setState({ status: "saving" });
    try {
      const review = await createOrGetReview(normalizeArxivId(arxivId), title);
      setState({ status: "saved", reviewId: review.id });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to add",
      });
    }
  }, [state, arxivId, title, router]);

  if (state.status === "saved") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2 py-1 text-[11px] font-medium text-success transition-colors hover:bg-success/15"
      >
        <Check className="size-3" strokeWidth={2.5} />
        In library — open
      </button>
    );
  }

  if (state.status === "error") {
    return (
      <button
        type="button"
        onClick={onClick}
        title={state.message}
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
      >
        Retry add
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state.status === "saving"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors",
        state.status === "saving"
          ? "opacity-70"
          : "hover:bg-primary/15",
      )}
    >
      {state.status === "saving" ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Plus className="size-3" strokeWidth={2.25} />
      )}
      Add to library
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  PaperCard — single paper row, reusable                             */
/* ------------------------------------------------------------------ */

/**
 * Renders one paper. When `rationale` is set, the rationale is shown in
 * place of the auto-truncated abstract — that's the curated-pick view
 * (`DiscoverPicks`). When `rationale` is absent, the abstract snippet is
 * shown — that's the raw-search view (`DiscoverArxivCards`, used as a
 * legacy fallback for pre-redesign session threads).
 */
export function PaperCard({
  paper,
  rationale,
}: {
  paper: PaperMeta;
  rationale?: string;
}) {
  return (
    <article className="rounded-lg border border-border/70 bg-card/60 px-3 py-2.5 transition-colors hover:border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold leading-snug text-foreground">
            {paper.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {paper.year ? <span>{paper.year}</span> : null}
            {paper.venue ? (
              <>
                <span aria-hidden>·</span>
                <span>{paper.venue}</span>
              </>
            ) : null}
            {paper.citations ? (
              <>
                <span aria-hidden>·</span>
                <span>{paper.citations}</span>
              </>
            ) : null}
          </div>
          {paper.authors ? (
            <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
              {paper.authors}
            </p>
          ) : null}
          {rationale ? (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground/85">
              {rationale}
            </p>
          ) : paper.abstract ? (
            <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-relaxed text-foreground/75">
              {paper.abstract}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {paper.arxivId ? (
            <AddToLibraryButton arxivId={paper.arxivId} title={paper.title} />
          ) : null}
          {paper.url ? (
            <a
              href={paper.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3" strokeWidth={2} />
              Open
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  DiscoverArxivCards — legacy raw-search renderer                    */
/* ------------------------------------------------------------------ */

/**
 * Used as a fallback for legacy discover threads (sessionStorage messages
 * created before the curated-picks redesign). The new flow renders cards
 * via `DiscoverPicks` from the agent's curated **Picks** list instead.
 */
export default function DiscoverArxivCards({ output }: { output: string }) {
  const { header, papers } = parseArxivSearchOutput(output);

  // Couldn't parse anything — fall through to the raw-text rendering so the
  // user still sees what the tool returned (e.g. "No papers found for…").
  if (papers.length === 0) {
    return (
      <pre className="my-2 whitespace-pre-wrap rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        {output.trim()}
      </pre>
    );
  }

  return (
    <div className="my-2 space-y-2">
      {header ? (
        <p className="text-[11px] text-muted-foreground/75">{header}</p>
      ) : null}
      <div className="grid grid-cols-1 gap-2">
        {papers.map((p, i) => (
          <PaperCard key={`${p.url || p.title}-${i}`} paper={p} />
        ))}
      </div>
    </div>
  );
}
