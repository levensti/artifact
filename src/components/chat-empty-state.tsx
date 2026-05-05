"use client";

import {
  BookOpen,
  BrainCircuit,
  Globe,
  Network,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ItalicAccent, MonoLabel } from "@/components/folio";

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
      <div className="mb-5 px-2">
        <MonoLabel>Where to start</MonoLabel>
        <p className="mt-2 text-[18px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
          Ask a question, or pick a{" "}
          <ItalicAccent>starting point.</ItalicAccent>
        </p>
        <p
          className="mt-1.5 text-[12.5px] leading-[1.55]"
          style={{
            fontFamily: "var(--font-reading)",
            color: "color-mix(in srgb, var(--foreground) 65%, transparent)",
          }}
        >
          The assistant searches arXiv and the web automatically when needed.
          Highlight any passage in the paper to start a thread tied to it.
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
              "group flex min-h-[5rem] w-full flex-col items-start gap-2 rounded-lg border bg-card px-3.5 py-3 text-left transition-all duration-200",
              canSend
                ? "cursor-pointer hover:-translate-y-px hover:border-primary/30 hover:shadow-[var(--shadow-sm)] active:translate-y-0"
                : "cursor-not-allowed opacity-50",
            )}
            style={{
              borderColor: "color-mix(in srgb, var(--border) 75%, transparent)",
            }}
          >
            <div
              className="flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
              style={{ background: "var(--badge-accent-bg)" }}
            >
              <s.icon
                className="size-3.5"
                style={{
                  color: "color-mix(in srgb, var(--primary) 70%, transparent)",
                }}
                strokeWidth={1.7}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-[12.5px] font-semibold leading-snug tracking-[-0.005em] text-foreground/85 transition-colors group-hover:text-foreground">
                {s.label}
              </p>
              <p
                className="line-clamp-2 text-[11.5px] leading-[1.5]"
                style={{
                  fontFamily: "var(--font-reading)",
                  color:
                    "color-mix(in srgb, var(--muted-foreground) 90%, transparent)",
                }}
              >
                {s.desc}
              </p>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-start gap-2 px-2">
        <BrainCircuit
          className="mt-0.5 size-3 shrink-0"
          strokeWidth={1.5}
          style={{
            color: "color-mix(in srgb, var(--muted-foreground) 50%, transparent)",
          }}
        />
        <span
          className="text-[10.5px] leading-snug"
          style={{
            color:
              "color-mix(in srgb, var(--muted-foreground) 60%, transparent)",
          }}
        >
          Searches arXiv &amp; the web automatically when needed
        </span>
      </div>
    </div>
  );
}
