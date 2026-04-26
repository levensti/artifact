"use client";

import type { ReactNode } from "react";
import { citationFromHref } from "@/lib/citation-transform";
import {
  resolveFigure,
  resolveReference,
  resolveSection,
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
export default function CitationChip({ href, children }: CitationChipProps) {
  const info = citationFromHref(href);
  const { parsedPaper, paperText, scrollToPage } = useCitationContext();

  let resolution: CitationResolution = {};
  if (info) {
    if (info.kind === "section") {
      resolution = resolveSection(info.value, parsedPaper, paperText);
    } else if (info.kind === "figure") {
      resolution = resolveFigure(info.value, parsedPaper, paperText);
    } else {
      resolution = resolveReference(info.value, parsedPaper, paperText);
    }
  }

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (resolution.page) scrollToPage(resolution.page);
  };

  return (
    <a
      href={href}
      onClick={onClick}
      className={`citation-chip${resolution.page ? "" : " citation-chip--unresolved"}`}
      title={resolution.tooltip ?? undefined}
    >
      {children}
    </a>
  );
}
