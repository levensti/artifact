"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export type PaperNodeData = {
  label: string;
  title: string;
  isAnchor: boolean;
  dimmed: boolean;
  hovered: boolean;
  /** Substring search matched title or arXiv id */
  searchMatch: boolean;
};

const handleStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" } as const;

export function PaperNode({ data, selected }: NodeProps) {
  const { label, title, isAnchor, dimmed, hovered, searchMatch } = data as PaperNodeData;

  return (
    <div
      className={cn(
        "relative flex h-full w-full cursor-pointer items-center justify-center rounded-lg border px-3.5 shadow-sm transition-all duration-200",
        isAnchor
          ? "border-primary/20 bg-primary text-primary-foreground shadow-md"
          : "border-border/70 bg-card/95 text-card-foreground shadow-sm backdrop-blur-[2px]",
        dimmed && "opacity-[0.22]",
        selected &&
          "ring-2 ring-primary/40 ring-offset-2 ring-offset-background shadow-md",
        !selected &&
          searchMatch &&
          !dimmed &&
          "ring-2 ring-amber-500/55 ring-offset-2 ring-offset-background",
        !selected &&
          !searchMatch &&
          hovered &&
          !dimmed &&
          (isAnchor ? "ring-1 ring-primary/30" : "ring-1 ring-border"),
      )}
      title={title}
    >
      <Handle
        id="t"
        type="target"
        position={Position.Top}
        style={handleStyle}
        className="h-px! min-h-0! min-w-0! w-px! border-0! opacity-0!"
      />
      <Handle
        id="s"
        type="source"
        position={Position.Top}
        style={handleStyle}
        className="h-px! min-h-0! min-w-0! w-px! border-0! opacity-0!"
      />
      <span
        className={cn(
          "text-center font-medium leading-tight tracking-tight",
          isAnchor ? "text-[9.5px]" : "text-[8.5px]",
        )}
        style={{ letterSpacing: "-0.01em" }}
      >
        {label}
      </span>
    </div>
  );
}
