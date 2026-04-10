"use client";

import {
  ArrowUpRight,
  BookOpen,
  Globe,
  Network,
  Search,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Conversation starters                                              */
/* ------------------------------------------------------------------ */

const STARTERS = [
  {
    icon: BookOpen,
    label: "Prerequisites",
    desc: "Background concepts and papers to read first",
    prompt:
      "What concepts and background should I understand before reading this paper? Search for the most important prerequisite papers.",
  },
  {
    icon: Network,
    label: "Related work",
    desc: "How this paper connects to neighboring research",
    prompt:
      "Find the most important related papers to this work. Search arXiv and explain how they connect.",
  },
  {
    icon: Search,
    label: "Key contributions",
    desc: "Main results and how they advance the field",
    prompt:
      "What are the key contributions of this paper? How do they advance the state of the art?",
  },
  {
    icon: Globe,
    label: "Explain the method",
    desc: "Step-by-step walkthrough with equations",
    prompt:
      "Walk me through the main method/approach in this paper step by step, including the key equations.",
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ChatEmptyState({
  canSend,
  onSend,
}: {
  canSend: boolean;
  onSend: (text: string) => void;
}) {
  return (
    <div className="flex flex-col pb-4 pt-0 font-sans antialiased">
      <div className="mb-5 space-y-2 px-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary/50" strokeWidth={1.75} />
          <p className="text-sm font-semibold leading-snug tracking-tight text-foreground">
            Research assistant
          </p>
        </div>
        <p className="min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
          Ask anything about this paper, or pick a starting point below.
        </p>
      </div>

      <div className="space-y-1 rounded-lg border border-border/50 bg-muted/20 p-1.5" style={{ boxShadow: "var(--shadow-inset)" }}>
        {STARTERS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={!canSend}
            onClick={() => onSend(s.prompt)}
            className={cn(
              "group flex min-h-14 w-full items-start gap-2.5 rounded-md px-2.5 py-2.5 text-left transition-all duration-150",
              canSend
                ? "cursor-pointer hover:bg-background active:bg-background/80"
                : "cursor-not-allowed opacity-50",
            )}
          >
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background transition-colors group-hover:border-border group-hover:bg-card" style={{ boxShadow: "var(--shadow-panel)" }}>
              <s.icon className="size-3.5 text-foreground/40 group-hover:text-foreground/60 transition-colors" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-xs font-medium leading-snug text-foreground/70 transition-colors group-hover:text-foreground/90">
                {s.label}
              </p>
              <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground/80">
                {s.desc}
              </p>
            </div>
            <ArrowUpRight
              className="mt-1 size-3 shrink-0 text-muted-foreground/0 transition-all duration-150 group-hover:text-muted-foreground/50"
              strokeWidth={2}
            />
          </button>
        ))}
      </div>

      <p className="mt-4 px-2 text-[10px] leading-snug text-muted-foreground/45">
        Searches arXiv &amp; the web automatically when needed
      </p>
    </div>
  );
}
