"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Globe,
  Lightbulb,
  Loader2,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { MonoLabel } from "./folio";
import { cn } from "@/lib/utils";
import { ThinkingIndicator } from "./chat-step-renderers";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import { EXA_KEY_REQUIRED_SENTINEL } from "@/tools/web-search";
import { PaperCard, parseArxivSearchOutput } from "./discover-arxiv-cards";
import { TextWithPicks, buildPoolFromSteps } from "./picks-shared";
import type { AgentStep } from "@/hooks/use-chat";

/* ------------------------------------------------------------------ */
/*  Search chip — collapsed tool_call with cards in expanded pane      */
/* ------------------------------------------------------------------ */

function resultCount(name: string, output: string | undefined): number | null {
  if (!output) return null;
  if (name === "arxiv_search") {
    const m = output.match(/^Found (\d+) papers/m);
    return m ? Number(m[1]) : null;
  }
  if (name === "web_search") {
    const m = output.match(/^Found (\d+) web results/m);
    return m ? Number(m[1]) : null;
  }
  return null;
}

const TOOL_DISPLAY: Record<string, { active: string; done: string }> = {
  arxiv_search: { active: "Searching", done: "Searched" },
  web_search: { active: "Searching", done: "Searched" },
  paper_details: { active: "Verifying", done: "Verified" },
};

function chipSubject(name: string, input: Record<string, unknown>): string | null {
  if (name === "paper_details") {
    return typeof input.arxivId === "string" ? input.arxivId : null;
  }
  return typeof input.query === "string" ? `"${input.query}"` : null;
}

function SearchChip({
  name,
  input,
  output,
}: {
  name: string;
  input: Record<string, unknown>;
  output?: string;
}) {
  const [open, setOpen] = useState(false);

  if (name === "web_search" && output?.trim() === EXA_KEY_REQUIRED_SENTINEL) {
    return <ExaKeyPromptCard />;
  }

  const done = !!output;
  const trimmedOutput = (output ?? "").trim();
  const failed =
    done &&
    /^(?:error:|paper search failed:|web search failed:|request failed:|no papers found|no web results)/i.test(
      trimmedOutput,
    );
  const subject = chipSubject(name, input);
  const count = done ? resultCount(name, output) : null;
  const display = TOOL_DISPLAY[name];
  const verb = display
    ? done
      ? display.done
      : display.active
    : done
      ? "Ran"
      : "Running";
  const displayName =
    name === "web_search" ? "web" : name === "paper_details" ? "paper" : "papers";

  // Expanded pane: for arxiv_search show the same card list users used to see
  // auto-rendered, so the full candidate set is still browsable behind the
  // chip. web_search falls back to raw text.
  const expanded = !output ? null : name === "arxiv_search" ? (
    (() => {
      const { papers } = parseArxivSearchOutput(output);
      if (papers.length === 0) {
        return (
          <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground/80 leading-relaxed">
            {output.trim()}
          </pre>
        );
      }
      return (
        <div className="grid grid-cols-1 gap-2">
          {papers.map((p, i) => (
            <PaperCard key={`${p.url || p.title}-${i}`} paper={p} />
          ))}
        </div>
      );
    })()
  ) : (
    <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground/80 leading-relaxed">
      {output.trim()}
    </pre>
  );

  return (
    <div className="my-1.5 rounded-md border border-border/70 bg-muted/15 text-xs overflow-hidden">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors",
          done && "hover:bg-muted/30 cursor-pointer",
          !done && "cursor-default",
        )}
        onClick={() => done && setOpen((v) => !v)}
        disabled={!done}
      >
        {done ? (
          failed ? (
            <X className="size-3 text-destructive shrink-0" strokeWidth={2.5} />
          ) : (
            <Check className="size-3 text-success shrink-0" strokeWidth={2.5} />
          )
        ) : (
          <Loader2 className="size-3 text-primary/60 animate-spin shrink-0" />
        )}
        {name === "web_search" ? (
          <Globe className="size-3 text-muted-foreground/70 shrink-0" />
        ) : name === "paper_details" ? (
          <FileText className="size-3 text-muted-foreground/70 shrink-0" />
        ) : (
          <Search className="size-3 text-muted-foreground/70 shrink-0" />
        )}
        <span
          className={cn(
            "font-medium",
            failed ? "text-destructive/90" : "text-foreground/80",
          )}
        >
          {verb} {displayName}
        </span>
        {subject ? (
          <span className="truncate max-w-[28ch] text-muted-foreground/70">
            · {subject}
          </span>
        ) : null}
        {count !== null ? (
          <span className="text-muted-foreground/60 shrink-0">
            · {count} results
          </span>
        ) : null}
        {done ? (
          <span className="ml-auto text-muted-foreground/50 shrink-0">
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </span>
        ) : null}
      </button>
      {open && expanded ? (
        <div className="border-t border-border/40 bg-muted/5 px-2.5 py-2 max-h-[28rem] overflow-y-auto">
          {expanded}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Phased progress — the legible arc of a research run                 */
/* ------------------------------------------------------------------ */

type Phase = "planning" | "searching" | "reading" | "synthesizing";

const PHASES: { key: Phase; label: string; icon: typeof Search }[] = [
  { key: "planning", label: "Planning", icon: Lightbulb },
  { key: "searching", label: "Searching", icon: Search },
  { key: "reading", label: "Reading", icon: FileText },
  { key: "synthesizing", label: "Synthesizing", icon: Sparkles },
];

interface Progress {
  phase: Phase;
  papersFound: number;
  papersRead: number;
}

function deriveProgress(steps: AgentStep[]): Progress {
  let papersFound = 0;
  let papersRead = 0;
  let sawTool = false;
  let hasSearch = false;
  let hasRead = false;
  let synthesizing = false;

  for (const s of steps) {
    if (s.kind === "tool_call") {
      sawTool = true;
      if (s.name === "arxiv_search" || s.name === "web_search") {
        hasSearch = true;
        const c = resultCount(s.name, s.output);
        if (c) papersFound += c;
      } else if (s.name === "paper_details") {
        hasRead = true;
        if (s.output) papersRead += 1;
      } else if (s.name === "submit_picks") {
        synthesizing = true;
      }
    } else if (s.kind === "text" && sawTool && s.text.trim()) {
      // A narrated segment after tools have run = the agent is writing up.
      synthesizing = true;
    }
  }

  const phase: Phase = synthesizing
    ? "synthesizing"
    : hasRead
      ? "reading"
      : hasSearch
        ? "searching"
        : "planning";

  return { phase, papersFound, papersRead };
}

function statusLine({ phase, papersFound, papersRead }: Progress): string {
  switch (phase) {
    case "planning":
      return "Planning the search…";
    case "searching":
      return papersFound > 0
        ? `Searching sources — ${papersFound} candidates found`
        : "Searching arXiv and the web…";
    case "reading":
      return papersRead > 0
        ? `Reading candidates — ${papersRead} verified`
        : "Reading the most promising candidates…";
    case "synthesizing":
      return "Ranking against your library…";
  }
}

function PhaseTracker({ phase }: { phase: Phase }) {
  const currentIdx = PHASES.findIndex((p) => p.key === phase);
  return (
    <div className="flex items-center gap-1.5">
      {PHASES.map((p, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        const Icon = p.icon;
        return (
          <div key={p.key} className="flex items-center gap-1.5">
            <div
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : done
                    ? "border-success/30 bg-success/[0.07] text-success/85"
                    : "border-border/60 bg-transparent text-muted-foreground/55",
              )}
            >
              {done ? (
                <Check className="size-3" strokeWidth={2.5} />
              ) : active ? (
                <Icon className="size-3 animate-pulse" strokeWidth={2} />
              ) : (
                <Icon className="size-3" strokeWidth={2} />
              )}
              {p.label}
            </div>
            {i < PHASES.length - 1 ? (
              <span
                className={cn(
                  "h-px w-2.5 shrink-0",
                  i < currentIdx ? "bg-success/40" : "bg-border/60",
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 px-4 py-3.5">
      <div className="discover-skeleton h-2.5 w-16" />
      <div className="discover-skeleton mt-2.5 h-3.5 w-3/4" />
      <div className="discover-skeleton mt-2 h-2.5 w-full" />
      <div className="discover-skeleton mt-1.5 h-2.5 w-5/6" />
    </div>
  );
}

/**
 * The in-flight view of a research run: a high-level phase arc + a plain
 * status line, the live tool trace beneath it for transparency, and
 * result-shaped skeletons so the user can see a reading list is coming.
 */
export function DiscoverLiveProgress({ steps }: { steps: AgentStep[] }) {
  const progress = useMemo(() => deriveProgress(steps), [steps]);
  const showSkeletons = progress.phase !== "synthesizing";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PhaseTracker phase={progress.phase} />
      </div>
      <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className="landing-pulse-dot" />
        {statusLine(progress)}
      </p>

      {/* Live trace — transparency without dominating the view */}
      <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
        <div className="mb-1.5">
          <MonoLabel>What I&apos;m doing</MonoLabel>
        </div>
        <DiscoverSteps steps={steps} />
      </div>

      {showSkeletons ? (
        <div className="space-y-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Public: DiscoverSteps                                              */
/* ------------------------------------------------------------------ */

export default function DiscoverSteps({ steps }: { steps: AgentStep[] }) {
  const pool = useMemo(() => buildPoolFromSteps(steps), [steps]);

  return (
    <>
      {steps.map((step, i) => {
        switch (step.kind) {
          case "thinking":
            return <ThinkingIndicator key={`think-${i}`} />;
          case "tool_call":
            // submit_picks is a finalize signal, not a meaningful user-facing
            // step. The agent's closing text confirmation is enough; the
            // queue itself is the visible outcome.
            if (step.name === "submit_picks") return null;
            return (
              <SearchChip
                key={step.id}
                name={step.name}
                input={step.input}
                output={step.output}
              />
            );
          case "text":
            return (
              <TextWithPicks key={`text-${i}`} text={step.text} pool={pool} />
            );
        }
      })}
    </>
  );
}
