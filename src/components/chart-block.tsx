"use client";

import { useMemo } from "react";
import ShimmerStatus from "./shimmer-status";
import ChartRenderer from "./chart-renderer";
import DiagramFallbackCard from "./diagram-fallback-card";
import { parseChartSpec } from "@/lib/diagram/chart-spec";

/**
 * Renders a ```chart fenced block: a JSON spec validated and normalized by
 * parseChartSpec, drawn by the native ChartRenderer. Mirrors MermaidDiagram's
 * contract — a shimmer while the block is still streaming in, a fallback card
 * when the spec can't be parsed. Parsing is synchronous and pure, so unlike
 * Mermaid there's no render queue, cache, or debounce.
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
    <div className="chat-chart">
      <ChartRenderer chart={result.chart} />
    </div>
  );
}
