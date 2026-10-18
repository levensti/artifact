"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  LayoutPanelTop,
} from "lucide-react";
import { sanitizeDiagramHtml } from "@/lib/diagram/diagram-html";
import type { CitationKind } from "@/lib/citation-transform";
import type { ArtifactContent } from "@/lib/artifacts";
import { cn } from "@/lib/utils";
import { useCitationNavigator } from "./citation-chip";
import DiagramFallbackCard from "./diagram-fallback-card";

/**
 * Opens an artifact in the Artifacts tab, next to the PDF, so citation chips
 * can scroll the paper while the artifact stays in view. Provided by
 * RightPanel; null where there's no panel to open into.
 */
export const ArtifactOpenerContext = createContext<
  ((artifact: ArtifactContent) => void) | null
>(null);

/* ------------------------------------------------------------------ */
/*  ArtifactView: the rendered artifact body                           */
/* ------------------------------------------------------------------ */

/**
 * Renders artifact HTML (sanitized in artifact mode) natively in the app's
 * theme. Paper references were turned into chip buttons by the sanitizer;
 * one delegated click handler resolves them against the open paper and
 * scrolls the PDF, the same way chat citation chips do.
 */
export function ArtifactView({ html }: { html: string }) {
  const result = useMemo(
    () => sanitizeDiagramHtml(html, undefined, { artifact: true }),
    [html],
  );
  const ref = useRef<HTMLDivElement>(null);
  const { resolve, navigate } = useCitationNavigator();

  const citeAt = (el: Element) => ({
    kind: el.getAttribute("data-cite-kind") as CitationKind,
    value: el.getAttribute("data-cite-value") ?? "",
  });

  // Mark chips we can't place in the paper, and give each a tooltip, the
  // same way CitationChip styles itself.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const chip of root.querySelectorAll("[data-cite-kind]")) {
      const resolution = resolve(citeAt(chip));
      chip.classList.toggle("citation-chip--unresolved", !resolution.page);
      if (resolution.tooltip) chip.setAttribute("title", resolution.tooltip);
    }
  });

  if (result.empty) {
    return <DiagramFallbackCard kind="diagram" source={html} />;
  }

  return (
    <div
      ref={ref}
      className="dx-diagram dx-artifact"
      onClick={(e) => {
        const chip = (e.target as Element).closest("[data-cite-kind]");
        if (!chip) return;
        e.preventDefault();
        navigate(citeAt(chip));
      }}
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  ArtifactCard: preview card that opens the artifact in its tab      */
/* ------------------------------------------------------------------ */

export function ArtifactCard({
  artifact,
  createdAt,
  className,
}: {
  artifact: ArtifactContent;
  /** ISO time, shown in the Artifacts tab. */
  createdAt?: string;
  className?: string;
}) {
  const open = useContext(ArtifactOpenerContext);

  return (
    <div
      className={cn(
        "group rounded-lg border border-border bg-card transition-colors hover:border-foreground/20",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => open?.(artifact)}
        disabled={!open}
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
      >
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <LayoutPanelTop className="size-3.5" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold leading-snug tracking-[-0.005em] text-foreground">
            {artifact.title}
          </span>
          {artifact.summary ? (
            <span className="mt-0.5 line-clamp-2 block text-[12px] leading-[1.5] text-muted-foreground">
              {artifact.summary}
            </span>
          ) : null}
          {createdAt ? (
            <span className="mt-1 block text-[11px] text-muted-foreground/70">
              {new Date(createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          ) : null}
        </span>
        <ChevronRight
          className="mt-1 size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ArtifactDetail: one artifact, open in the Artifacts tab            */
/* ------------------------------------------------------------------ */

/**
 * The open artifact, filling the Artifacts tab. It sits beside the PDF, so a
 * citation chip scrolls the paper while the artifact stays put; widening the
 * panel gives both room.
 */
export function ArtifactDetail({
  artifact,
  onBack,
}: {
  artifact: ArtifactContent;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-4 pb-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1.5 inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2} aria-hidden />
          All artifacts
        </button>
        <h2 className="mt-1.5 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
          {artifact.title}
        </h2>
        {artifact.summary ? (
          <p className="mt-1 text-[12.5px] leading-[1.55] text-muted-foreground">
            {artifact.summary}
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ArtifactView html={artifact.html} />
      </div>
    </div>
  );
}
