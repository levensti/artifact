"use client";

import {
  ArrowUpRight,
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

      <div className="space-y-0.5">
        {STARTERS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={!canSend}
            onClick={() => onSend(s.prompt)}
            className={cn(
              "group flex min-h-14 w-full items-start gap-2.5 rounded-lg px-2 py-2.5 text-left transition-all duration-150",
              canSend
                ? "cursor-pointer hover:bg-foreground/4 active:bg-foreground/6"
                : "cursor-not-allowed opacity-50",
            )}
          >
            <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border/50 bg-foreground/5 transition-colors group-hover:border-border/70 group-hover:bg-foreground/8">
              <s.icon className="size-3 text-foreground/45" strokeWidth={1.8} />
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

      <div className="mt-5 flex items-start gap-2 px-2">
        <BrainCircuit
          className="mt-0.5 size-3 shrink-0 text-muted-foreground/35"
          strokeWidth={1.5}
        />
        <span className="text-[10px] leading-snug text-muted-foreground/45 not-italic">
          Searches arXiv &amp; the web automatically when needed
        </span>
      </div>
    </div>
  );
}
