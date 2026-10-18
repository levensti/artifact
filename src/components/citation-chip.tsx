"use client";

import type { ReactNode } from "react";
import {
  citationFromHref,
  type CitationLinkInfo,
} from "@/lib/citation-transform";
import {
  resolveFigure,
  resolveReference,
  resolveSection,
  resolveTable,
  type CitationResolution,
} from "@/lib/citation-resolver";
import { useCitationContext } from "./citation-context";

interface CitationChipProps {
  href: string;
  children: ReactNode;
}

/**
 * Renders a citation token (e.g. "(§3.2)", "(Fig. 1)", "(Ref. [27])") that
 * the agent emitted in chat. On click, scrolls the PDF viewer to the
 * citation's page when we can resolve it from either the parsed paper
 * structure (long-paper mode) or by scanning the raw extracted text for
 * `[Page N]` markers (works for any paper).
 *
 * Resolution is best-effort: if neither lookup yields a page, the chip
 * still renders with whatever tooltip text is available. Click is a no-op
 * in that case rather than scrolling somewhere arbitrary.
 */
/**
 * Resolve and navigate citations against the open paper. Shared by
 * CitationChip and surfaces that build chips outside markdown (ArtifactView).
 */
export function useCitationNavigator() {
  const { pageMap, paperText, scrollToPage } = useCitationContext();
  const resolve = (info: CitationLinkInfo): CitationResolution => {
    if (info.kind === "section") return resolveSection(info.value, paperText, pageMap);
    if (info.kind === "figure") return resolveFigure(info.value, paperText, pageMap);
    if (info.kind === "table") return resolveTable(info.value, paperText, pageMap);
    return resolveReference(info.value, paperText);
  };
  /** Scroll the PDF to the citation. Returns false when it can't be placed. */
  const navigate = (info: CitationLinkInfo, resolution = resolve(info)) => {
    if (!resolution.page) return false;
    // Figure/table captions sit BELOW their content, so center them to keep
    // the figure in view; section headings go to the top and read downward.
    const block =
      info.kind === "figure" || info.kind === "table" ? "center" : "start";
    scrollToPage(resolution.page, resolution.anchorText, block);
    return true;
  };
  return { resolve, navigate };
}

export default function CitationChip({ href, children }: CitationChipProps) {
  const info = citationFromHref(href);
  const { resolve, navigate } = useCitationNavigator();
  const resolution: CitationResolution = info ? resolve(info) : {};

  // Fire on pointerdown so a streaming chip navigates the instant the user
  // presses on it — by the time `click` would fire, the typewriter may have
  // re-rendered the markdown and moved the chip out from under the cursor,
  // so mouseup lands on a different element and `click` never fires. Filter
  // to primary button so right/middle clicks don't navigate.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (info) navigate(info, resolution);
  };
  // Keyboard fallback: Enter on a focused link should still navigate.
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (info) navigate(info, resolution);
  };

  return (
    <a
      href={href}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={`citation-chip${resolution.page ? "" : " citation-chip--unresolved"}`}
      title={resolution.tooltip ?? undefined}
    >
      {children}
    </a>
  );
}
