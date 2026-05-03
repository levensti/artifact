"use client";

import { useEffect, useState } from "react";
import {
  BookMarked,
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
import type { WikiPage } from "@/lib/wiki";

interface ShareJournalDialogProps {
  page: WikiPage | null;
  onClose: () => void;
}

type LinkState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "ready"; token: string; url: string; reused: boolean; depth: number }
  | { kind: "error"; message: string };

export default function ShareJournalDialog({ page, onClose }: ShareJournalDialogProps) {
  const [linkState, setLinkState] = useState<LinkState>({ kind: "idle" });
  const [includeLinked, setIncludeLinked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // Close → reset.
  useEffect(() => {
    if (!page) {
      setLinkState({ kind: "idle" });
      setIncludeLinked(false);
      setCopied(false);
      return;
    }
    if (linkState.kind !== "idle") return;
    void mintLink(page.slug, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.slug]);

  // When the user toggles "include linked pages", mint a fresh link
  // for the new depth. The previous link still exists and works at the
  // old depth — the user can revoke explicitly if needed. This avoids
  // surprising URL changes when the toggle is flipped accidentally.
  useEffect(() => {
    if (!page) return;
    const desiredDepth = includeLinked ? 1 : 0;
    if (linkState.kind === "ready" && linkState.depth === desiredDepth) return;
    if (linkState.kind === "creating") return;
    void mintLink(page.slug, desiredDepth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeLinked]);

  async function mintLink(slug: string, depth: number) {
    setLinkState({ kind: "creating" });
    try {
      const result = await createShareLink({
        kind: "wiki",
        wikiSlug: slug,
        wikiDepth: depth,
      });
      setLinkState({
        kind: "ready",
        token: result.token,
        url: buildShareUrl(result.token),
        reused: result.reused,
        depth,
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
    } catch {
      fallbackCopy(linkState.url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function handleRevoke() {
    if (linkState.kind !== "ready" || !page) return;
    if (
      !window.confirm(
        "Revoke this link? Anyone holding it will no longer be able to import.",
      )
    )
      return;
    setRevoking(true);
    try {
      await revokeShareLink(linkState.token);
      await mintLink(page.slug, includeLinked ? 1 : 0);
    } catch (err) {
      setLinkState({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to revoke",
      });
    } finally {
      setRevoking(false);
    }
  }

  const isWorking = linkState.kind === "creating" || revoking;

  const isDigest = page?.pageType === "digest";

  return (
    <Dialog
      open={page !== null}
      onOpenChange={(next) => {
        if (!next && !isWorking) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Share2 className="size-[14px]" strokeWidth={2} />
            </span>
            <DialogTitle>Share this entry</DialogTitle>
          </div>
          <DialogDescription>
            Anyone with the link can import a copy into their own journal.
          </DialogDescription>
        </DialogHeader>

        {page ? (
          <div className="rounded-lg border border-border/70 bg-card/50 px-3.5 py-3">
            <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/60">
              {isDigest ? (
                <Sparkles className="size-2.5" strokeWidth={2} />
              ) : (
                <BookMarked className="size-2.5" strokeWidth={2} />
              )}
              <span>{isDigest ? "Weekly digest" : "Study session"}</span>
            </div>
            <p
              className="mt-1 truncate text-[13.5px] font-medium text-foreground"
              title={page.title}
            >
              {page.title}
            </p>
          </div>
        ) : null}

        <LinkBlock
          state={linkState}
          copied={copied}
          revoking={revoking}
          onCopy={handleCopy}
          onRevoke={handleRevoke}
          onRetry={() => page && mintLink(page.slug, includeLinked ? 1 : 0)}
        />

        <DepthToggle
          checked={includeLinked}
          onChange={setIncludeLinked}
          disabled={isWorking}
        />
      </DialogContent>
    </Dialog>
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
          <span>
            {state.reused
              ? "Existing link — anyone with it can already import."
              : "Link generated. No expiry — revoke any time."}
          </span>
          <button
            type="button"
            onClick={onRevoke}
            disabled={revoking}
            className="text-[11px] underline-offset-4 transition-colors hover:text-destructive hover:underline disabled:opacity-50"
          >
            {revoking ? "Revoking…" : "Revoke"}
          </button>
        </div>
      </div>
    );
  }
  return null;
}

function DepthToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border border-border/60 bg-card/30 px-3 py-2.5 transition-colors hover:bg-card/60",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <span className="relative mt-0.5 inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-muted transition-colors data-[on=true]:bg-primary"
        data-on={checked}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={cn(
            "absolute left-0.5 size-3 rounded-full bg-card shadow-sm transition-transform",
            checked ? "translate-x-3" : "translate-x-0",
          )}
        />
      </span>
      <span className="flex-1">
        <span className="block text-[12.5px] font-medium text-foreground">
          Include linked pages
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
          Pull in pages directly referenced via{" "}
          <code className="rounded bg-muted px-1 py-px text-[10.5px]">[[link]]</code>{" "}
          on this page.
        </span>
      </span>
    </label>
  );
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
