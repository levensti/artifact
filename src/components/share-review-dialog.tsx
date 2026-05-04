"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Link2,
  Loader2,
  RefreshCcw,
  Share2,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildShareUrl,
  createShareLink,
  revokeShareLink,
} from "@/lib/client/sharing/share-links";
import { cn } from "@/lib/utils";
import type { PaperReview } from "@/lib/reviews";

interface ShareReviewDialogProps {
  review: PaperReview | null;
  onClose: () => void;
}

type LinkState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "ready"; token: string; url: string; reused: boolean }
  | { kind: "error"; message: string };

export default function ShareReviewDialog({
  review,
  onClose,
}: ShareReviewDialogProps) {
  const [linkState, setLinkState] = useState<LinkState>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // Auto-mint a link as soon as the dialog opens for a review. Sharing
  // should feel like one tap — the link is ready before the user even
  // looks for the button.
  useEffect(() => {
    if (!review) {
      setLinkState({ kind: "idle" });
      setCopied(false);
      return;
    }
    if (linkState.kind !== "idle") return;
    void mintLink(review.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review?.id]);

  async function mintLink(reviewId: string) {
    setLinkState({ kind: "creating" });
    try {
      const result = await createShareLink({ kind: "review", reviewId });
      setLinkState({
        kind: "ready",
        token: result.token,
        url: buildShareUrl(result.token),
        reused: result.reused,
      });
    } catch (err) {
      setLinkState({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to create link",
      });
    }
  }

  async function handleCopy() {
    if (linkState.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(linkState.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can fail in non-secure contexts (e.g. http preview).
      // Fall back to selection-based copy.
      fallbackCopy(linkState.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  async function handleRevoke() {
    if (linkState.kind !== "ready" || !review) return;
    if (
      !window.confirm(
        "Revoke this link? Anyone holding it will no longer be able to import.",
      )
    )
      return;
    setRevoking(true);
    try {
      await revokeShareLink(linkState.token);
      // Mint a fresh one so the dialog stays useful — revoking the old
      // is the common "I shared with the wrong person" path, and the
      // user almost always wants a clean new URL right after.
      await mintLink(review.id);
    } catch (err) {
      setLinkState({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to revoke",
      });
    } finally {
      setRevoking(false);
    }
  }

  const sourceLabel = review?.arxivId
    ? `arXiv:${review.arxivId}`
    : (review?.sourceUrl ?? "Unknown source");

  const isWorking = linkState.kind === "creating" || revoking;

  return (
    <Dialog
      open={review !== null}
      onOpenChange={(next) => {
        if (!next && !isWorking) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Share2 className="size-3.5" strokeWidth={2} />
            </span>
            <DialogTitle>Share this review</DialogTitle>
          </div>
          <DialogDescription>
            Anyone with the link can import a copy of your review, including
            chats, annotations, deep dives, etc, into their own Artifact
            workspace.
          </DialogDescription>
        </DialogHeader>

        {/* Subject card — what's being shared */}
        {review ? (
          <div className="min-w-0 rounded-lg border border-border/70 bg-card/50 px-3.5 py-3">
            <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/60">
              <Sparkles className="size-2.5" strokeWidth={2} />
              <span>Sharing</span>
            </div>
            <p
              className="mt-1 line-clamp-2 text-[13.5px] leading-snug font-medium break-words text-foreground"
              title={review.title}
            >
              {review.title}
            </p>
            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground/85">
              {sourceLabel}
            </p>
          </div>
        ) : null}

        {/* The link */}
        <LinkBlock
          state={linkState}
          copied={copied}
          revoking={revoking}
          onCopy={handleCopy}
          onRevoke={handleRevoke}
          onRetry={() => review && mintLink(review.id)}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ── Pieces ────────────────────────────────────────────────────── */

function LinkBlock({
  state,
  copied,
  revoking,
  onCopy,
  onRevoke,
  onRetry,
}: {
  state: LinkState;
  copied: boolean;
  revoking: boolean;
  onCopy: () => void;
  onRevoke: () => void;
  onRetry: () => void;
}) {
  if (state.kind === "creating") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 bg-muted/20 px-3.5 py-3 text-[12.5px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
        <span>Creating link…</span>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-[12.5px] text-destructive">
        <p>{state.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium underline-offset-4 hover:underline"
        >
          <RefreshCcw className="size-3" strokeWidth={2} /> Try again
        </button>
      </div>
    );
  }
  if (state.kind === "ready") {
    return (
      <div className="space-y-2">
        <div className="group flex items-stretch gap-1.5 rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-sm)] transition-shadow focus-within:shadow-[var(--shadow-primary)]">
          <div className="flex items-center pl-2.5 text-muted-foreground/70">
            <Link2 className="size-3.5" strokeWidth={2} />
          </div>
          <input
            readOnly
            value={state.url}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 bg-transparent px-1 py-1.5 text-[12.5px] tracking-tight text-foreground outline-none"
            aria-label="Share link"
          />
          <button
            type="button"
            onClick={onCopy}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-all duration-150",
              copied
                ? "bg-success/15 text-success"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {copied ? (
              <>
                <Check className="size-3.5" strokeWidth={2.25} />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" strokeWidth={2} />
                Copy
              </>
            )}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground/65">
          <button
            type="button"
            onClick={onRevoke}
            disabled={revoking}
            className="text-[11px] underline-offset-4 transition-colors hover:text-destructive hover:underline disabled:opacity-50"
          >
            {revoking ? "Revoking…" : "Revoke share link"}
          </button>
        </div>
      </div>
    );
  }
  return null;
}

function fallbackCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* noop */
  }
  document.body.removeChild(ta);
}
