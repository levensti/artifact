"use client";

import { cn } from "@/lib/utils";
import { MonoLabel } from "@/components/folio";

/* ------------------------------------------------------------------ */
/*  Conversation starters                                              */
/* ------------------------------------------------------------------ */

const STARTERS = [
  {
    label: "Prerequisites",
    desc: "Background concepts and papers to read first",
    prompt:
      "What concepts and background should I understand before reading this paper?",
  },
  {
    label: "Related work",
    desc: "How this paper connects to neighboring research",
    prompt:
      "Find the most important related papers to this work. Search arXiv and explain how they connect.",
  },
  {
    label: "Key contributions",
    desc: "Main results and how they advance the field",
    prompt:
      "What are the key contributions of this paper? How do they advance the state of the art?",
  },
  {
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
      <div className="mb-5 px-2">
        <MonoLabel>Where to start</MonoLabel>
        <p className="mt-2 text-[18px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          Ask a question, or pick a{" "}
          <span className="text-muted-foreground">starting point.</span>
        </p>
        <p className="mt-1.5 text-[12.5px] leading-[1.55] text-muted-foreground">
          The assistant searches arXiv and the web automatically when needed.
          Highlight any passage in the paper to start a thread tied to it.
        </p>
      </div>

      {/* Hairline spec-sheet grid, same anatomy as the landing's facts row. */}
      <div className="landing-grid grid grid-cols-2 overflow-hidden rounded-lg bg-card">
        {STARTERS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={!canSend}
            onClick={() => onSend(s.prompt)}
            className={cn(
              "flex min-h-[4.5rem] w-full flex-col items-start gap-0.5 px-3.5 py-3 text-left transition-colors duration-150",
              canSend
                ? "cursor-pointer hover:bg-muted/60"
                : "cursor-not-allowed opacity-50",
            )}
          >
            <span className="text-[13px] font-semibold leading-snug tracking-[-0.005em] text-foreground">
              {s.label}
            </span>
            <span className="line-clamp-2 text-[12px] leading-[1.5] text-muted-foreground">
              {s.desc}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
