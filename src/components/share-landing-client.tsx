"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookMarked,
  ChevronRight,
  ExternalLink,
  Loader2,
  Sparkles,
  Telescope,
} from "lucide-react";
import type { SharePreview } from "@/server/shares";
import { apiFetch } from "@/lib/client/api";
import { BrandGlyph, BrandPanel, SignupPitch } from "@/components/brand-panel";
import { cn } from "@/lib/utils";

interface Props {
  token: string;
  state: "ok" | "revoked";
  preview: SharePreview | null;
  isOwner: boolean;
  isAuthed: boolean;
  autoImport: boolean;
  /// Canonical path for this landing page (e.g. `/share/<token>`).
  /// Used to build the `?callbackUrl=` for the auth round-trip so the
  /// visitor lands back here after sign-in/sign-up.
  landingPath: string;
}

interface ImportResult {
  kind: "review" | "wiki";
  finalReviewId?: string;
  importedSlugs?: string[];
  alreadyOwner?: boolean;
}

type Stage =
  | { kind: "idle" }
  | { kind: "importing" }
  | { kind: "imported"; result: ImportResult }
  | { kind: "error"; message: string };

export default function ShareLandingClient({
  token,
  state,
  preview,
  isOwner,
  isAuthed,
  autoImport,
  landingPath,
}: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const autoFiredRef = useRef(false);

  const handleImport = async (options: { force?: boolean } = {}) => {
    setStage({ kind: "importing" });
    try {
      const result = await apiFetch<ImportResult>(
        `/api/shares/${encodeURIComponent(token)}/import`,
        { method: "POST", body: options },
      );
      setStage({ kind: "imported", result });
      // Brief pause so the "Imported!" state is visible before navigation.
      setTimeout(() => navigateToImported(router, result), 600);
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : "Import failed",
      });
    }
  };

  // Auto-import when the visitor returns from sign-in/sign-up. Fire
  // once on mount and only if we have a session.
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (!autoImport || !isAuthed || state !== "ok" || isOwner) return;
    autoFiredRef.current = true;
    void handleImport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "revoked") return <RevokedView />;
  if (!preview) return null;

  return (
    <main className="grid min-h-screen bg-background md:grid-cols-2">
      <BrandPanel>
        <SignupPitch />
      </BrandPanel>

      <section className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          {/* Inline brand mark — only when the side panel is hidden */}
          <div className="mb-10 flex items-center gap-2 md:hidden">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BrandGlyph className="size-4" />
            </span>
            <span className="text-base font-semibold tracking-tight text-foreground">
              Artifact
            </span>
          </div>

          <Eyebrow kind={preview.payload.kind} />

          <h1 className="mt-3 text-balance text-[26px] font-semibold leading-[1.2] tracking-tight text-foreground sm:text-[28px]">
            <span className="text-foreground">
              {preview.sharerFirstName ?? "Someone"}
            </span>{" "}
            <span className="text-muted-foreground/80">
              {preview.payload.kind === "review"
                ? "shared a paper review with you"
                : "shared a journal entry with you"}
            </span>
          </h1>

          <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
            One click and a copy lands in your workspace: chats, annotations,
            notes, and all.
          </p>

          <div className="mt-7">
            {preview.payload.kind === "review" ? (
              <ReviewCard payload={preview.payload} />
            ) : (
              <WikiCard payload={preview.payload} />
            )}
          </div>

          <div className="mt-6">
            <CtaArea
              landingPath={landingPath}
              isAuthed={isAuthed}
              isOwner={isOwner}
              stage={stage}
              preview={preview}
              onImport={handleImport}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

/* ── Header pieces ─────────────────────────────────────────────── */

function Eyebrow({ kind }: { kind: "review" | "wiki" }) {
  const Icon = kind === "review" ? Telescope : Sparkles;
  return (
    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-primary/80">
      <Icon className="size-3.5" strokeWidth={1.8} />
      <span>
        {kind === "review" ? "Shared paper review" : "Shared journal entry"}
      </span>
    </div>
  );
}

/* ── Resource cards ────────────────────────────────────────────── */

function ReviewCard({
  payload,
}: {
  payload: Extract<SharePreview["payload"], { kind: "review" }>;
}) {
  const sourceLabel = payload.arxivId
    ? `arXiv:${payload.arxivId}`
    : payload.sourceUrl
      ? safeHostname(payload.sourceUrl)
      : "Unknown source";
  const sourceUrl = payload.arxivId
    ? `https://arxiv.org/abs/${encodeURIComponent(payload.arxivId)}`
    : (payload.sourceUrl ?? null);

  return (
    <section className="rounded-xl border border-border/70 bg-card p-5 shadow-(--shadow-sm)">
      <h2 className="text-balance text-[16px] font-semibold leading-snug tracking-tight text-foreground">
        {payload.title}
      </h2>
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {sourceLabel}
          <ExternalLink className="size-3" strokeWidth={1.75} />
        </a>
      ) : (
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          {sourceLabel}
        </p>
      )}

      <CountPills counts={payload.counts} />
    </section>
  );
}

function CountPills({
  counts,
}: {
  counts: { messages: number; annotations: number; deepDives: number };
}) {
  const items: Array<{ label: string; value: number }> = [];
  if (counts.messages > 0) {
    items.push({
      label: counts.messages === 1 ? "message" : "messages",
      value: counts.messages,
    });
  }
  if (counts.annotations > 0) {
    items.push({
      label: counts.annotations === 1 ? "annotation" : "annotations",
      value: counts.annotations,
    });
  }
  if (counts.deepDives > 0) {
    items.push({
      label: counts.deepDives === 1 ? "deep dive" : "deep dives",
      value: counts.deepDives,
    });
  }
  if (items.length === 0) return null;
  return (
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
      {items.map(({ label, value }) => (
        <li key={label} className="inline-flex items-baseline gap-1">
          <span className="font-semibold tabular-nums text-foreground">
            {value}
          </span>
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}

function WikiCard({
  payload,
}: {
  payload: Extract<SharePreview["payload"], { kind: "wiki" }>;
}) {
  const isDigest = payload.pageType === "digest";
  return (
    <section className="rounded-xl border border-border/70 bg-card p-5 shadow-(--shadow-sm)">
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/60">
        {isDigest ? (
          <Sparkles className="size-2.5" strokeWidth={2} />
        ) : (
          <BookMarked className="size-2.5" strokeWidth={2} />
        )}
        <span>{isDigest ? "Weekly digest" : "Study session"}</span>
      </div>
      <h2 className="mt-1.5 text-balance text-[16px] font-semibold leading-snug tracking-tight text-foreground">
        {payload.rootTitle}
      </h2>
      {payload.excerpt ? (
        <p className="mt-3 line-clamp-4 text-[12.5px] leading-relaxed text-muted-foreground">
          {payload.excerpt}
        </p>
      ) : null}
      {payload.depth > 0 && payload.pageCount > 1 ? (
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
          + {payload.pageCount - 1} linked{" "}
          {payload.pageCount - 1 === 1 ? "page" : "pages"}
        </p>
      ) : null}
    </section>
  );
}

/* ── CTA ───────────────────────────────────────────────────────── */

function CtaArea({
  landingPath,
  isAuthed,
  isOwner,
  stage,
  preview,
  onImport,
}: {
  landingPath: string;
  isAuthed: boolean;
  isOwner: boolean;
  stage: Stage;
  preview: SharePreview;
  onImport: (options?: { force?: boolean }) => void;
}) {
  const router = useRouter();
  const callbackUrl = `${landingPath}?autoImport=1`;
  const cb = `?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  if (isOwner) {
    const targetHref =
      preview.payload.kind === "review"
        ? `/review/${(preview.payload as Extract<SharePreview["payload"], { kind: "review" }>).reviewId}`
        : `/journal?page=${encodeURIComponent(
            (
              preview.payload as Extract<
                SharePreview["payload"],
                { kind: "wiki" }
              >
            ).rootSlug,
          )}`;
    // The owner sees a forced-clone affordance below the primary CTA so
    // they can exercise the recipient flow against their own share —
    // useful for QA / dogfooding without needing a second account.
    if (stage.kind === "importing") {
      return (
        <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" strokeWidth={2} />
          <span>Cloning a copy into your library…</span>
        </div>
      );
    }
    if (stage.kind === "imported") {
      return (
        <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-[13px] text-success">
          <Check className="size-4" strokeWidth={2.25} />
          <span>Cloned — opening it now…</span>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted-foreground">
          You created this share. Anyone with the link can import a copy.
        </p>
        <button
          type="button"
          onClick={() => router.push(targetHref)}
          className={primaryBtnCls}
        >
          Open the original
          <ChevronRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            strokeWidth={2}
          />
        </button>
        <button
          type="button"
          onClick={() => onImport({ force: true })}
          className="text-[12px] text-muted-foreground/80 underline-offset-4 hover:text-foreground hover:underline"
        >
          Or test the recipient flow — import a copy into your own library
        </button>
        {stage.kind === "error" ? (
          <p className="text-[12px] text-destructive">{stage.message}</p>
        ) : null}
      </div>
    );
  }

  if (stage.kind === "imported") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-[13px] text-success">
        <Check className="size-4" strokeWidth={2.25} />
        <span>Imported — opening it now…</span>
      </div>
    );
  }

  if (stage.kind === "error") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
          {stage.message}
        </div>
        <button
          type="button"
          onClick={() => onImport()}
          className="text-[13px] font-medium text-primary underline-offset-4 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (isAuthed) {
    const importing = stage.kind === "importing";
    return (
      <button
        type="button"
        onClick={() => onImport()}
        disabled={importing}
        className={cn(
          primaryBtnCls,
          importing && "cursor-progress opacity-90 hover:translate-y-0",
        )}
      >
        {importing ? (
          <>
            <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            <span>Importing…</span>
          </>
        ) : (
          <>
            <span>Import to my Artifact</span>
            <ChevronRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </>
        )}
      </button>
    );
  }

  // Logged out
  return (
    <div className="space-y-3">
      <Link href={`/signup${cb}`} className={primaryBtnCls}>
        Create an account to import
        <ChevronRight
          className="size-4 transition-transform group-hover:translate-x-0.5"
          strokeWidth={2}
        />
      </Link>
      <p className="text-[12.5px] text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={`/signin${cb}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

const primaryBtnCls =
  "group inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-[13.5px] font-medium text-primary-foreground shadow-[var(--shadow-primary)] transition-all duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-md)]";

/* ── Revoked state ─────────────────────────────────────────────── */

function RevokedView() {
  return (
    <main className="grid min-h-screen place-items-center bg-reader-mat px-6 text-center">
      <div className="max-w-md">
        <span className="mx-auto mb-6 flex size-12 items-center justify-center rounded-2xl bg-card shadow-(--shadow-sm)">
          <BrandGlyph className="size-5 text-primary" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This link has been revoked
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
          The person who shared this changed their mind. Reach out to them
          directly if you&apos;d like access.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
        >
          Go to Artifact
        </Link>
      </div>
    </main>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

function Check({
  className,
  strokeWidth,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function navigateToImported(
  router: ReturnType<typeof useRouter>,
  result: ImportResult,
) {
  if (result.kind === "review" && result.finalReviewId) {
    router.push(`/review/${result.finalReviewId}`);
    return;
  }
  if (result.kind === "wiki") {
    const slug = result.importedSlugs?.[0];
    if (slug) {
      router.push(`/journal?page=${encodeURIComponent(slug)}`);
      return;
    }
    router.push("/journal");
    return;
  }
  router.push("/");
}
