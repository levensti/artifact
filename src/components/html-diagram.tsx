"use client";

import { useMemo } from "react";
import ShimmerStatus from "./shimmer-status";
import DiagramFrame from "./diagram-lightbox";
import DiagramFallbackCard from "./diagram-fallback-card";
import { sanitizeDiagramHtml } from "@/lib/diagram/diagram-html";

/**
 * Renders a ```diagram fenced block: GenUI HTML in the dx-* design-system
 * vocabulary, sanitized by sanitizeDiagramHtml and styled entirely by the
 * app's own CSS, so diagrams match the app theme for free.
 *
 * While the block is still streaming in we show the shared shimmer rather
 * than a half-built diagram; sanitization is synchronous and pure, so there
 * is no render queue, cache, or debounce.
 */
export default function HtmlDiagram({
  code,
  streaming = false,
}: {
  code: string;
  streaming?: boolean;
}) {
  const result = useMemo(
    () => (streaming ? null : sanitizeDiagramHtml(code)),
    [code, streaming],
  );

  if (streaming || result === null) {
    return <ShimmerStatus label="Drawing the diagram" />;
  }
  if (result.empty) {
    return <DiagramFallbackCard kind="diagram" source={code} />;
  }

  const body = (expandedSize: boolean) => (
    <div
      className={expandedSize ? "dx-diagram dx-expanded" : "dx-diagram"}
      role="img"
      aria-label={result.title ?? "diagram"}
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  );

  return (
    <DiagramFrame
      title={result.title ?? "Diagram"}
      className="chat-diagram"
      expanded={body(true)}
    >
      {body(false)}
    </DiagramFrame>
  );
}
