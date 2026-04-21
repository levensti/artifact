"use client";

import {
  BookOpen,
  BrainCircuit,
  Globe,
  Network,
  Search,
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
      <div className="mb-4 space-y-1 px-2">
        <p className="text-sm font-semibold leading-snug tracking-tight text-foreground">
          Research assistant
        </p>
        <p className="min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
          Ask anything, or pick a starting point below.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {STARTERS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={!canSend}
            onClick={() => onSend(s.prompt)}
            className={cn(
              "group flex min-h-[4.5rem] w-full flex-col items-start gap-2 rounded-xl border border-border bg-card px-3.5 py-3 text-left shadow-sm transition-all duration-200",
              canSend
                ? "cursor-pointer hover:border-primary/30 hover:shadow-md hover:shadow-primary/8 hover:-translate-y-px active:translate-y-0 active:shadow-sm"
                : "cursor-not-allowed opacity-50",
            )}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--badge-accent-bg)] transition-colors group-hover:bg-primary/15">
              <s.icon className="size-4 text-primary/60" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-[13px] font-semibold leading-snug text-foreground/80 transition-colors group-hover:text-foreground">
                {s.label}
              </p>
              <p className="line-clamp-2 text-xs leading-snug text-muted-foreground/70">
                {s.desc}
              </p>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-start gap-2 px-2">
        <BrainCircuit
          className="mt-0.5 size-3 shrink-0 text-muted-foreground/40"
          strokeWidth={1.5}
        />
        <span className="text-[10px] leading-snug text-muted-foreground/40 not-italic">
          Searches arXiv &amp; the web automatically when needed
        </span>
      </div>
    </div>
  );
}
