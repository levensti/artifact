"use client";

import { useMemo } from "react";
import ShimmerStatus from "./shimmer-status";
import ChartRenderer from "./chart-renderer";
import DiagramFallbackCard from "./diagram-fallback-card";
import DiagramFrame from "./diagram-lightbox";
import { parseChartSpec } from "@/lib/diagram/chart-spec";

/**
 * Renders a ```chart fenced block: a JSON spec validated and normalized by
 * parseChartSpec, drawn by the native ChartRenderer. Mirrors HtmlDiagram's
 * contract — a shimmer while the block is still streaming in, a fallback card
 * when the spec can't be parsed. Parsing is synchronous and pure: no render
 * queue, cache, or debounce.
 */
export default function ChartBlock({
  code,
  streaming = false,
}: {
  code: string;
  streaming?: boolean;
}) {
  const result = useMemo(
    () => (streaming ? null : parseChartSpec(code)),
    [code, streaming],
  );

  if (streaming || result === null) {
    return <ShimmerStatus label="Drawing the chart" />;
  }
  if (!result.ok) {
    return <DiagramFallbackCard kind="chart" source={code} />;
  }
  return (
    <DiagramFrame
      title={result.chart.title ?? "chart"}
      className="chat-chart"
      expanded={<ChartRenderer chart={result.chart} />}
    >
      <ChartRenderer chart={result.chart} />
    </DiagramFrame>
  );
}
