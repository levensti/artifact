"use client";

import {
  GraduationCap,
  Network,
  LayoutPanelTop,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MonoLabel } from "@/components/folio";

/* ------------------------------------------------------------------ */
/*  Conversation starters                                              */
/* ------------------------------------------------------------------ */

const STARTERS: Array<{
  label: string;
  desc: string;
  prompt: string;
  icon: LucideIcon;
  /** Send right away instead of filling the composer for editing. */
  autoSend?: boolean;
}> = [
  {
    label: "Skim the paper",
    icon: LayoutPanelTop,
    desc: "An interactive overview, saved to Artifacts",
    prompt:
      "Build an interactive overview of this paper that I can skim instead of reading it in full: the problem, the core idea, how the method works, the key results, and the limitations.",
    autoSend: true,
  },
  {
    label: "Prerequisites",
    icon: GraduationCap,
    desc: "Background concepts and papers to read first",
    prompt:
      "What concepts and background should I understand before reading this paper?",
  },
  {
    label: "Related work",
    icon: Network,
    desc: "How this paper connects to neighboring research",
    prompt:
      "Find the most important related papers to this work. Search arXiv and explain how they connect.",
  },
  {
    label: "Key contributions",
    icon: Sparkles,
    desc: "Main results and how they advance the field",
    prompt:
      "What are the key contributions of this paper? How do they advance the state of the art?",
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ChatEmptyState({
  canFill,
  canSend,
  onFill,
  onSend,
}: {
  /** False while the paper is still being prepared (the composer is locked). */
  canFill: boolean;
  /** False until a message could actually be sent now. */
  canSend: boolean;
  /** Puts the starter's prompt in the composer for the user to edit and send. */
  onFill: (prompt: string) => void;
  /** Sends an auto-send starter's prompt immediately. */
  onSend: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-col pb-4 pt-0 font-sans antialiased">
      <div className="mb-5 px-2">
        <MonoLabel>Where to start</MonoLabel>
        <p className="mt-2 text-[18px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          Ask a question, or pick a{" "}
          <span className="text-muted-foreground">starting point.</span>
        </p>
        <p className="mt-1.5 text-[12.5px] leading-[1.55] text-muted-foreground">
          Your assistant searches arXiv and the web automatically when needed.
          Highlight any passage in the paper to start a thread tied to it.
        </p>
      </div>

      {/* Hairline spec-sheet grid, same anatomy as the landing's facts row. */}
      <div className="landing-grid grid grid-cols-2 overflow-hidden rounded-lg bg-card">
        {STARTERS.map((s) => {
          const enabled = s.autoSend ? canSend : canFill;
          return (
            <button
              key={s.label}
              type="button"
              disabled={!enabled}
              onClick={() => (s.autoSend ? onSend(s.prompt) : onFill(s.prompt))}
              className={cn(
                "flex min-h-[4.5rem] w-full flex-col items-start gap-0.5 px-3.5 py-3 text-left transition-colors duration-150",
                enabled
                  ? "cursor-pointer hover:bg-muted/60"
                  : "cursor-not-allowed opacity-50",
              )}
            >
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold leading-snug tracking-[-0.005em] text-foreground">
                <s.icon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                  aria-hidden
                />
                {s.label}
              </span>
              <span className="line-clamp-2 text-[12px] leading-[1.5] text-muted-foreground">
                {s.desc}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
