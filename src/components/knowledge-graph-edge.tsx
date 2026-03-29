"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

export type RelationshipEdgeData = {
  label: string;
  color: string;
  dimmed: boolean;
  incident: boolean;
};

export function RelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const d = data as RelationshipEdgeData | undefined;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const dimmed = d?.dimmed ?? false;
  const incident = d?.incident ?? true;
  const color = d?.color ?? "var(--muted-foreground)";
  const label = d?.label ?? "";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: incident ? 2 : 1.35,
          strokeOpacity: dimmed ? 0.12 : incident ? 0.9 : 0.45,
          strokeDasharray: dimmed ? "4 6" : undefined,
        }}
      />
      {!dimmed && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none select-none"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 8,
              fontWeight: 600,
              color,
              opacity: incident ? 1 : 0.78,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
