"use client";

import { Search } from "lucide-react";
import type { RelationshipType } from "@/lib/explore";
import { RELATIONSHIP_SHORT_LABEL } from "@/lib/explore";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EDGE_COLORS } from "./graph-flow-builders";

/* ------------------------------------------------------------------ */
/*  Paper search                                                       */
/* ------------------------------------------------------------------ */

export function GraphPaperSearch({
  value,
  onChange,
  matchCount,
  total,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  matchCount: number;
  total: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex w-full min-w-0 max-w-sm items-center gap-2",
        className,
      )}
    >
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        aria-label="Search papers by title or arXiv id"
        placeholder="Search papers…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full min-w-0 border-border/80 bg-card/90 pl-8 backdrop-blur-sm"
      />
      {value.trim() ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {matchCount}/{total}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Legend                                                              */
/* ------------------------------------------------------------------ */

const LEGEND_ORDER: RelationshipType[] = [
  "prerequisite",
  "builds-upon",
  "extends",
  "similar-approach",
  "contrasts-with",
];

export function GraphLegend({ className }: { className?: string }) {
  return (
    <div
      className={`inline-flex flex-wrap gap-x-3.5 gap-y-1 text-[10px] rounded-md border border-border/60 bg-card/80 backdrop-blur-sm px-3 py-2 ${className ?? ""}`}
    >
      {LEGEND_ORDER.map((rel) => (
        <span key={rel} className="inline-flex items-center gap-1.5">
          <span
            className="size-[7px] rounded-full shrink-0"
            style={{ backgroundColor: EDGE_COLORS[rel] }}
          />
          <span className="text-foreground/70 font-medium">
            {RELATIONSHIP_SHORT_LABEL[rel]}
          </span>
        </span>
      ))}
    </div>
  );
}
