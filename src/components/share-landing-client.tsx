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
} from "lucide-react";
import type { SharePreview } from "@/server/shares";
import { apiFetch } from "@/lib/client/api";
import { BrandGlyph, BrandPanel, SignupPitch } from "@/components/brand-panel";
import { ItalicAccent, MonoLabel } from "@/components/folio";
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

  const handleImport = async () => {
    setStage({ kind: "importing" });
    try {
      const result = await apiFetch<ImportResult>(
        `/api/shares/${encodeURIComponent(token)}/import`,
        { method: "POST" },
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

  const sharerName = preview.sharerFirstName ?? "Someone";
  const isReview = preview.payload.kind === "review";

  return (
    <main
      className="grid min-h-screen md:grid-cols-2"
      style={{ background: "var(--reader-mat)" }}
    >
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

          <MonoLabel>
            {isReview ? "Shared paper review" : "Shared journal entry"}
          </MonoLabel>

          <h1
            className="mt-4 text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-foreground sm:text-[32px]"
            style={{ textWrap: "balance" }}
          >
            {sharerName} shared{" "}
            <ItalicAccent>
              {isReview ? "a paper review" : "a journal entry"}
            </ItalicAccent>{" "}
            with you.
          </h1>

          <p
            className="mt-4 text-[14px] leading-[1.6]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 72%, transparent)",
            }}
          >
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

/* ── Resource cards ────────────────────────────────────────────── */

function KindGlyph({ kind, isDigest }: { kind: "review" | "wiki"; isDigest?: boolean }) {
  // Inline SVG matches the journal/landing chip-glyph rhythm.
  if (kind === "review") {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-3"
        aria-hidden
      >
        <path d="M3 2.5h6.5L13 6v7.5H3z" />
        <path d="M9.5 2.5V6H13" />
      </svg>
    );
  }
  if (isDigest) {
    return <Sparkles className="size-3" strokeWidth={1.8} aria-hidden />;
  }
  return <BookMarked className="size-3" strokeWidth={1.8} aria-hidden />;
}

function CardChrome({
  kind,
  kindLabel,
  children,
  accent,
}: {
  kind: "review" | "wiki";
  kindLabel: string;
  isDigest?: boolean;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-sm)]"
      style={{
        borderColor: accent
          ? "color-mix(in srgb, var(--primary) 22%, transparent)"
          : "color-mix(in srgb, var(--border) 75%, transparent)",
        background: accent
          ? "color-mix(in srgb, var(--primary) 4%, var(--card))"
          : "var(--card)",
      }}
    >
      <header
        className="flex items-center gap-2 border-b px-3.5 py-2.5"
        style={{
          background:
            "color-mix(in srgb, var(--reader-mat) 50%, var(--card))",
          borderColor:
            "color-mix(in srgb, var(--border) 70%, transparent)",
        }}
      >
        <span
          className="inline-flex size-[20px] items-center justify-center rounded-md"
          style={{
            background: "var(--badge-accent-bg)",
            color: "color-mix(in srgb, var(--primary) 70%, transparent)",
          }}
        >
          <KindGlyph kind={kind} isDigest={kindLabel === "Weekly digest"} />
        </span>
        <MonoLabel>{kindLabel}</MonoLabel>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

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
    <CardChrome kind="review" kindLabel="Paper review">
      <h2
        className="text-[16.5px] font-semibold leading-[1.3] tracking-[-0.012em] text-foreground"
        style={{ textWrap: "balance" }}
      >
        {payload.title}
      </h2>
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          style={{ letterSpacing: "0.02em" }}
        >
          {sourceLabel}
          <ExternalLink className="size-3" strokeWidth={1.75} />
        </a>
      ) : (
        <p
          className="mt-1.5 font-mono text-[11.5px] text-muted-foreground"
          style={{ letterSpacing: "0.02em" }}
        >
          {sourceLabel}
        </p>
      )}

      <CountPills counts={payload.counts} />
    </CardChrome>
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
    <ul
      className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]"
      style={{
        color: "color-mix(in srgb, var(--muted-foreground) 90%, transparent)",
        fontFeatureSettings: '"tnum"',
      }}
    >
      {items.map(({ label, value }) => (
        <li key={label} className="inline-flex items-baseline gap-1">
          <span
            className="font-semibold"
            style={{
              color:
                "color-mix(in srgb, var(--foreground) 80%, transparent)",
            }}
          >
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
    <CardChrome
      kind="wiki"
      kindLabel={isDigest ? "Weekly digest" : "Study session"}
      accent={isDigest}
    >
      <h2
        className="text-[16.5px] font-semibold leading-[1.3] tracking-[-0.012em] text-foreground"
        style={{ textWrap: "balance" }}
      >
        {payload.rootTitle}
      </h2>
      {payload.excerpt ? (
        <p
          className="mt-3 line-clamp-4 text-[13px] leading-[1.6]"
          style={{
            fontFamily: "var(--font-reading)",
            color:
              "color-mix(in srgb, var(--muted-foreground) 95%, transparent)",
          }}
        >
          {payload.excerpt}
        </p>
      ) : null}
      {payload.depth > 0 && payload.pageCount > 1 ? (
        <p
          className="mt-4 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
          style={{
            background: "var(--badge-accent-bg)",
            color: "var(--badge-accent-fg)",
          }}
        >
          + {payload.pageCount - 1} linked{" "}
          {payload.pageCount - 1 === 1 ? "page" : "pages"}
        </p>
      ) : null}
    </CardChrome>
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
  onImport: () => void;
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
    return (
      <div className="space-y-3">
        <p
          className="text-[12.5px] leading-[1.55]"
          style={{
            fontFamily: "var(--font-reading)",
            color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
          }}
        >
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
      </div>
    );
  }

  if (stage.kind === "imported") {
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-4 py-3 text-[13px]"
        style={{
          background: "color-mix(in srgb, var(--success) 12%, transparent)",
          color: "color-mix(in srgb, var(--success) 90%, transparent)",
        }}
      >
        <Check className="size-4" strokeWidth={2.25} />
        <span>Imported. Opening it now…</span>
      </div>
    );
  }

  if (stage.kind === "error") {
    return (
      <div className="space-y-3">
        <div
          className="rounded-lg border px-4 py-3 text-[13px]"
          style={{
            borderColor:
              "color-mix(in srgb, var(--destructive) 30%, transparent)",
            background:
              "color-mix(in srgb, var(--destructive) 5%, transparent)",
            color: "var(--destructive)",
          }}
        >
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
      <p
        className="text-[12.5px] leading-[1.55]"
        style={{
          fontFamily: "var(--font-reading)",
          color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
        }}
      >
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
    <main
      className="grid min-h-screen place-items-center px-6 text-center"
      style={{ background: "var(--reader-mat)" }}
    >
      <div className="max-w-md">
        <span
          className="mx-auto mb-7 flex size-12 items-center justify-center rounded-md bg-card shadow-[var(--shadow-sm)]"
          style={{
            border:
              "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
          }}
        >
          <BrandGlyph className="size-5 text-primary" />
        </span>
        <MonoLabel>Link revoked</MonoLabel>
        <h1
          className="mt-3 text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-foreground"
          style={{ textWrap: "balance" }}
        >
          This share was <ItalicAccent>taken down.</ItalicAccent>
        </h1>
        <p
          className="mt-4 text-[14px] leading-[1.6]"
          style={{
            fontFamily: "var(--font-reading)",
            color: "color-mix(in srgb, var(--foreground) 72%, transparent)",
          }}
        >
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
