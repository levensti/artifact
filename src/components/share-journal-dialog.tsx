"use client";

import { useEffect, useState } from "react";
import {
  BookMarked,
  Check,
  Copy,
  Link2,
  Loader2,
  RefreshCcw,
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
import { ItalicAccent, MonoLabel } from "@/components/folio";
import { cn } from "@/lib/utils";
import type { WikiPage } from "@/lib/wiki";

interface ShareJournalDialogProps {
  page: WikiPage | null;
  onClose: () => void;
}

type LinkState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "ready"; token: string; url: string; reused: boolean }
  | { kind: "error"; message: string };

export default function ShareJournalDialog({
  page,
  onClose,
}: ShareJournalDialogProps) {
  const [linkState, setLinkState] = useState<LinkState>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // Close → reset.
  useEffect(() => {
    if (!page) {
      setLinkState({ kind: "idle" });
      setCopied(false);
      return;
    }
    if (linkState.kind !== "idle") return;
    void mintLink(page.slug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.slug]);

  async function mintLink(slug: string) {
    setLinkState({ kind: "creating" });
    try {
      const result = await createShareLink({
        kind: "wiki",
        wikiSlug: slug,
        wikiDepth: 0,
      });
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
      await mintLink(page.slug);
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader className="space-y-2.5">
          <MonoLabel>Sharing</MonoLabel>
          <DialogTitle
            className="text-[22px] font-semibold leading-[1.15] tracking-[-0.022em]"
            style={{ textWrap: "balance" }}
          >
            Share your <ItalicAccent>entry</ItalicAccent> with a colleague.
          </DialogTitle>
          <DialogDescription
            className="text-[13.5px] leading-[1.55]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
            }}
          >
            Anyone with the link can import a copy into their own journal.
          </DialogDescription>
        </DialogHeader>

        {page ? (
          <SubjectCard
            title={page.title}
            isDigest={isDigest}
          />
        ) : null}

        <LinkBlock
          state={linkState}
          copied={copied}
          revoking={revoking}
          onCopy={handleCopy}
          onRevoke={handleRevoke}
          onRetry={() => page && mintLink(page.slug)}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ── Pieces ────────────────────────────────────────────────────── */

function SubjectCard({
  title,
  isDigest,
}: {
  title: string;
  isDigest: boolean;
}) {
  const Icon = isDigest ? Sparkles : BookMarked;
  return (
    <section
      className="overflow-hidden rounded-lg border bg-card"
      style={{
        borderColor: isDigest
          ? "color-mix(in srgb, var(--primary) 22%, transparent)"
          : "color-mix(in srgb, var(--border) 75%, transparent)",
        background: isDigest
          ? "color-mix(in srgb, var(--primary) 4%, var(--card))"
          : "var(--card)",
      }}
    >
      <header
        className="flex items-center gap-2 border-b px-3.5 py-2"
        style={{
          background:
            "color-mix(in srgb, var(--reader-mat) 50%, var(--card))",
          borderColor:
            "color-mix(in srgb, var(--border) 70%, transparent)",
        }}
      >
        <span
          className="inline-flex size-[18px] items-center justify-center rounded-md"
          style={{
            background: isDigest
              ? "color-mix(in srgb, var(--primary) 14%, transparent)"
              : "var(--badge-accent-bg)",
            color: "color-mix(in srgb, var(--primary) 70%, transparent)",
          }}
        >
          <Icon className="size-2.5" strokeWidth={1.8} aria-hidden />
        </span>
        <MonoLabel>{isDigest ? "Weekly digest" : "Study session"}</MonoLabel>
      </header>
      <div className="px-4 py-3">
        <p
          className="line-clamp-2 break-words text-[14px] font-semibold leading-[1.35] tracking-[-0.005em] text-foreground"
          title={title}
        >
          {title}
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
          borderColor:
            "color-mix(in srgb, var(--border) 70%, transparent)",
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
          background:
            "color-mix(in srgb, var(--destructive) 5%, transparent)",
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
            borderColor:
              "color-mix(in srgb, var(--primary) 22%, transparent)",
            background:
              "color-mix(in srgb, var(--primary) 4%, var(--card))",
          }}
        >
          <div className="flex items-center pl-2.5">
            <Link2
              className="size-3.5"
              strokeWidth={2}
              style={{
                color:
                  "color-mix(in srgb, var(--primary) 65%, transparent)",
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
            {state.reused ? "Existing link" : "Live link"}
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
