"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Prerequisite } from "@/lib/explore";
import { Button } from "@/components/ui/button";
import MarkdownMessage from "@/components/markdown-message";

interface PrerequisitesSectionProps {
  prerequisites: Prerequisite[];
  loadingTopicId: string | null;
  onLearnMore: (item: Prerequisite) => void;
}

const DIFFICULTY_STYLE: Record<Prerequisite["difficulty"], string> = {
  foundational: "bg-emerald-100/50 text-emerald-900 border-emerald-300/70",
  intermediate: "bg-amber-100/50 text-amber-900 border-amber-300/70",
  advanced: "bg-rose-100/45 text-rose-900 border-rose-300/70",
};

export default function PrerequisitesSection({
  prerequisites,
  loadingTopicId,
  onLearnMore,
}: PrerequisitesSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {prerequisites.map((item) => {
        const expanded = expandedId === item.id;
        const loading = loadingTopicId === item.id;
        return (
          <div key={item.id} className="rounded-md border border-border bg-card overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : item.id)}
              className="w-full px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground leading-tight">{item.topic}</p>
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                      DIFFICULTY_STYLE[item.difficulty],
                    )}
                  >
                    {item.difficulty}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    "size-4 text-muted-foreground mt-0.5 transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                {item.description}
              </p>
            </button>

            {expanded && (
              <div className="px-3 pb-3 space-y-2">
                {!item.explanation ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-8 text-xs"
                    disabled={loading}
                    onClick={() => onLearnMore(item)}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin mr-1.5" />
                        Loading explanation...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-3.5 mr-1.5" />
                        Learn more
                      </>
                    )}
                  </Button>
                ) : (
                  <div className="rounded-sm border border-border/80 bg-muted/20 p-2.5 text-sm">
                    <MarkdownMessage content={item.explanation} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
