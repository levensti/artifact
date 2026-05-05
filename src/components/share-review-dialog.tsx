"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, RefreshCcw } from "lucide-react";
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
import { ItalicAccent, MonoLabel } from "@/components/folio";
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
      <DialogContent className="sm:max-w-120">
        <DialogHeader className="space-y-2.5">
          <MonoLabel>Sharing</MonoLabel>
          <DialogTitle
            className="text-[22px] font-semibold leading-[1.15] tracking-[-0.022em]"
            style={{ textWrap: "balance" }}
          >
            Share <ItalicAccent>your review</ItalicAccent> with a colleague.
          </DialogTitle>
          <DialogDescription
            className="text-[13.5px] leading-[1.55]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
            }}
          >
            Anyone with the link can import a copy with chats, annotations, and
            deep dives intact.
          </DialogDescription>
        </DialogHeader>

        {/* Subject — what's being shared, rendered as a folio specimen */}
        {review ? (
          <SubjectCard title={review.title} sourceLabel={sourceLabel} />
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

function SubjectCard({
  title,
  sourceLabel,
}: {
  title: string;
  sourceLabel: string;
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border bg-card"
      style={{
        borderColor: "color-mix(in srgb, var(--border) 75%, transparent)",
      }}
    >
      <header
        className="flex items-center gap-2 border-b px-3.5 py-2"
        style={{
          background: "color-mix(in srgb, var(--reader-mat) 50%, var(--card))",
          borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
        }}
      >
        <span
          className="inline-flex size-[18px] items-center justify-center rounded-md"
          style={{
            background: "var(--badge-accent-bg)",
            color: "color-mix(in srgb, var(--primary) 70%, transparent)",
          }}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-2.5"
            aria-hidden
          >
            <path d="M3 2.5h6.5L13 6v7.5H3z" />
            <path d="M9.5 2.5V6H13" />
          </svg>
        </span>
        <MonoLabel>Paper review</MonoLabel>
      </header>
      <div className="px-4 py-3">
        <p
          className="line-clamp-2 break-words text-[14px] font-semibold leading-[1.35] tracking-[-0.005em] text-foreground"
          title={title}
        >
          {title}
        </p>
        <p
          className="mt-1 truncate font-mono text-[11px]"
          style={{
            letterSpacing: "0.02em",
            color:
              "color-mix(in srgb, var(--muted-foreground) 90%, transparent)",
          }}
        >
          {sourceLabel}
        </p>
      </div>
    </section>
  );
}

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
      <div
        className="flex items-center gap-2 rounded-lg border bg-card px-3.5 py-3 text-[12.5px] text-muted-foreground"
        style={{
          borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
        }}
      >
        <Loader2
          className="size-3.5 animate-spin"
          strokeWidth={2}
          style={{
            color: "color-mix(in srgb, var(--primary) 70%, transparent)",
          }}
        />
        <span>Creating a fresh link…</span>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div
        className="rounded-lg border px-3.5 py-3 text-[12.5px]"
        style={{
          borderColor:
            "color-mix(in srgb, var(--destructive) 30%, transparent)",
          background: "color-mix(in srgb, var(--destructive) 5%, transparent)",
          color: "var(--destructive)",
        }}
      >
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
      <div className="space-y-2.5">
        <div
          className="group flex items-stretch gap-1.5 rounded-lg border bg-card p-1 transition-shadow focus-within:shadow-[var(--shadow-primary)]"
          style={{
            borderColor: "color-mix(in srgb, var(--primary) 22%, transparent)",
            background: "color-mix(in srgb, var(--primary) 4%, var(--card))",
          }}
        >
          <div className="flex items-center pl-2.5">
            <Link2
              className="size-3.5"
              strokeWidth={2}
              style={{
                color: "color-mix(in srgb, var(--primary) 65%, transparent)",
              }}
            />
          </div>
          <input
            readOnly
            value={state.url}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 bg-transparent px-1 py-1.5 font-mono text-[12px] tracking-tight text-foreground outline-none"
            style={{ letterSpacing: "0.02em" }}
            aria-label="Share link"
          />
          <button
            type="button"
            onClick={onCopy}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors duration-150",
              copied
                ? "text-foreground"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
            style={
              copied
                ? {
                    background:
                      "color-mix(in srgb, var(--success) 14%, transparent)",
                    color:
                      "color-mix(in srgb, var(--success) 90%, transparent)",
                  }
                : undefined
            }
            aria-label={copied ? "Link copied" : "Copy link"}
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
        <div className="flex items-center justify-between gap-2 px-1">
          <span
            className="font-mono text-[10.5px] uppercase"
            style={{
              letterSpacing: "0.16em",
              color:
                "color-mix(in srgb, var(--muted-foreground) 65%, transparent)",
            }}
          >
            Live link
          </span>
          <button
            type="button"
            onClick={onRevoke}
            disabled={revoking}
            className="text-[11.5px] text-muted-foreground underline-offset-4 transition-colors hover:text-destructive hover:underline disabled:opacity-50"
          >
            {revoking ? "Revoking…" : "Revoke link"}
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
