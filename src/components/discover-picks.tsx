"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronRight,
  FileText,
  Globe,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { MonoLabel } from "./folio";
import { cn } from "@/lib/utils";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import { EXA_KEY_REQUIRED_SENTINEL } from "@/tools/web-search";
import { PaperCard, parseArxivSearchOutput } from "./discover-arxiv-cards";
import { TextWithPicks, buildPoolFromSteps } from "./picks-shared";
import type { AgentStep } from "@/hooks/use-chat";

/* ------------------------------------------------------------------ */
/*  Tool-call display helpers                                           */
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

const TOOL_FAILED_RE =
  /^(?:error:|paper search failed:|web search failed:|request failed:|no papers found|no web results)/i;

function chipSubject(name: string, input: Record<string, unknown>): string | null {
  if (name === "paper_details") {
    return typeof input.arxivId === "string" ? input.arxivId : null;
  }
  return typeof input.query === "string" ? `"${input.query}"` : null;
}

function toolFields(
  name: string,
  input: Record<string, unknown>,
  output: string | undefined,
) {
  const done = !!output;
  const failed = done && TOOL_FAILED_RE.test((output ?? "").trim());
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
    name === "web_search"
      ? "web"
      : name === "paper_details"
        ? "paper"
        : "papers";
  return { done, failed, subject, count, verb, displayName };
}

/* ------------------------------------------------------------------ */
/*  Phase derivation — drives the single live status line               */
/* ------------------------------------------------------------------ */

type Phase = "planning" | "searching" | "reading" | "synthesizing";

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
        ? `Searching sources, ${papersFound} candidates found`
        : "Searching arXiv and the web…";
    case "reading":
      return papersRead > 0
        ? `Reading candidates, ${papersRead} verified`
        : "Reading the most promising candidates…";
    case "synthesizing":
      return "Writing your briefing…";
  }
}

/* ------------------------------------------------------------------ */
/*  Living document — the brief assembling itself, top to bottom        */
/* ------------------------------------------------------------------ */

/** Expandable detail for a finished search/verify call. */
function ToolExpanded({ name, output }: { name: string; output: string }) {
  if (name === "arxiv_search") {
    const { papers } = parseArxivSearchOutput(output);
    if (papers.length > 0) {
      return (
        <div className="grid grid-cols-1 gap-2">
          {papers.map((p, i) => (
            <PaperCard key={`${p.url || p.title}-${i}`} paper={p} />
          ))}
        </div>
      );
    }
  }
  return (
    <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground/80">
      {output.trim()}
    </pre>
  );
}

/** One tool action's content. The spine marker is supplied by TimelineRow. */
function ToolAction({
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

  const { done, failed, subject, count, verb, displayName } = toolFields(
    name,
    input,
    output,
  );
  const Icon =
    name === "web_search" ? Globe : name === "paper_details" ? FileText : Search;

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => done && setOpen((v) => !v)}
        disabled={!done}
        className={cn(
          "flex w-full items-center gap-1.5 text-left text-[12.5px]",
          done ? "cursor-pointer" : "cursor-default",
        )}
      >
        <Icon
          className="size-3.5 shrink-0 text-muted-foreground/55"
          strokeWidth={1.9}
        />
        <span
          className={cn(
            "font-medium",
            failed ? "text-destructive/90" : "text-foreground/85",
          )}
        >
          {verb} {displayName}
        </span>
        {subject ? (
          <span className="truncate text-muted-foreground/65">· {subject}</span>
        ) : null}
        {count !== null ? (
          <span className="shrink-0 text-muted-foreground/55">
            · {count} results
          </span>
        ) : null}
        {done ? (
          <ChevronRight
            className={cn(
              "ml-0.5 size-3 shrink-0 text-muted-foreground/40 transition-transform",
              open && "rotate-90",
            )}
          />
        ) : null}
      </button>
      {open && output ? (
        <div className="mt-2 max-h-[26rem] overflow-y-auto rounded-md border border-border/40 bg-muted/10 p-2">
          <ToolExpanded name={name} output={output} />
        </div>
      ) : null}
    </div>
  );
}

const RUNNING_MARKER = (
  <Loader2 className="size-3.5 animate-spin text-primary/70" />
);
const THINKING_MARKER = (
  <span className="size-1.5 animate-pulse rounded-full bg-primary/45" />
);
function doneMarker(failed: boolean): ReactNode {
  if (failed) return <X className="size-3 text-destructive" strokeWidth={3} />;
  return (
    <span className="flex size-4 items-center justify-center rounded-full bg-primary/12 text-primary">
      <Check className="size-2.5" strokeWidth={3} />
    </span>
  );
}

/** A row on the spine: a marker column (dot + connector) and the content. */
function TimelineRow({
  marker,
  isLast,
  children,
}: {
  marker: ReactNode;
  isLast: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex w-4 shrink-0 flex-col items-center">
        <span className="mt-px flex size-4 items-center justify-center">
          {marker}
        </span>
        {!isLast ? (
          <span className="w-px flex-1 bg-border/55" aria-hidden />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 pb-3.5">{children}</div>
    </div>
  );
}

/** The agent's work — searches, reads, thinking — as a living timeline. */
function WorkTimeline({ steps }: { steps: AgentStep[] }) {
  const nodes = steps.filter(
    (s) =>
      s.kind === "thinking" ||
      (s.kind === "tool_call" && s.name !== "submit_picks"),
  );
  if (nodes.length === 0) return null;

  return (
    <div>
      {nodes.map((step, i) => {
        const isLast = i === nodes.length - 1;
        if (step.kind === "tool_call") {
          const done = !!step.output;
          const failed =
            done && TOOL_FAILED_RE.test((step.output ?? "").trim());
          return (
            <TimelineRow
              key={step.id}
              isLast={isLast}
              marker={done ? doneMarker(failed) : RUNNING_MARKER}
            >
              <ToolAction
                name={step.name}
                input={step.input}
                output={step.output}
              />
            </TimelineRow>
          );
        }
        return (
          <TimelineRow key={`th-${i}`} isLast={isLast} marker={THINKING_MARKER}>
            <span
              className="text-[12.5px] italic text-muted-foreground/65"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              Thinking…
            </span>
          </TimelineRow>
        );
      })}
    </div>
  );
}

/** The synthesis, writing itself as the agent narrates after searching. */
function LiveSynthesis({
  steps,
  pool,
}: {
  steps: AgentStep[];
  pool: ReturnType<typeof buildPoolFromSteps>;
}) {
  const text = steps
    .flatMap((s) => (s.kind === "text" && s.text.trim() ? [s.text] : []))
    .join("\n\n")
    .trim();
  if (!text) return null;

  return (
    <div className="rounded-lg border border-primary/15 bg-primary/[0.03] px-3.5 py-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        <MonoLabel tone="accent">Writing the brief</MonoLabel>
        <span
          className="size-1.5 animate-pulse rounded-full bg-primary/60"
          aria-hidden
        />
      </div>
      <div className="text-[13px] leading-relaxed">
        <TextWithPicks text={text} pool={pool} />
      </div>
    </div>
  );
}

/** A reading-list-shaped placeholder so the forming brief foreshadows itself. */
function ReadingSkeleton() {
  return (
    <div className="rounded-xl border border-border/50 bg-card/40 px-4 py-3.5">
      <div className="discover-skeleton h-2.5 w-16" />
      <div className="discover-skeleton mt-2.5 h-3.5 w-3/4" />
      <div className="discover-skeleton mt-2 h-2.5 w-full" />
      <div className="discover-skeleton mt-1.5 h-2.5 w-5/6" />
    </div>
  );
}

/**
 * The in-flight research run as a single living document: one live status
 * line, the agent's work building down a timeline, the synthesis writing
 * itself, and the reading list forming below.
 */
export function DiscoverLiveProgress({ steps }: { steps: AgentStep[] }) {
  const progress = useMemo(() => deriveProgress(steps), [steps]);
  const pool = useMemo(() => buildPoolFromSteps(steps), [steps]);
  const synthesizing = progress.phase === "synthesizing";

  return (
    <div className="space-y-4">
      {/* One consolidated live status (no chip stepper, no duplicate sentence) */}
      <div className="flex items-center gap-2.5">
        <span className="landing-pulse-dot" />
        <span className="text-[13px] font-medium text-foreground/85">
          {statusLine(progress)}
        </span>
      </div>

      {/* The work, building down a spine */}
      <WorkTimeline steps={steps} />

      {/* The brief, writing itself */}
      {synthesizing ? <LiveSynthesis steps={steps} pool={pool} /> : null}

      {/* The reading list, forming below */}
      <div className="space-y-2">
        <ReadingSkeleton />
        <ReadingSkeleton />
      </div>
    </div>
  );
}
