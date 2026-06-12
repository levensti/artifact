"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  FileText,
  Globe,
  Search,
  X,
} from "lucide-react";
import { MonoLabel } from "./folio";
import { cn } from "@/lib/utils";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import { EXA_KEY_REQUIRED_SENTINEL } from "@/tools/web-search";
import type { PaperMeta } from "@/lib/discover-paper-metadata";
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
      return "Planning your research…";
    case "searching":
      return papersFound > 0
        ? `Mapping the landscape · ${papersFound} sources`
        : "Mapping the landscape…";
    case "reading":
      return papersRead > 0
        ? `Reading the key work · ${papersRead} verified`
        : "Reading the most relevant work…";
    case "synthesizing":
      return "Writing your brief…";
  }
}

/* ------------------------------------------------------------------ */
/*  Phase rail — a calm Map → Read → Write progress indicator           */
/* ------------------------------------------------------------------ */

const PHASE_ORDER: Phase[] = ["searching", "reading", "synthesizing"];
const PHASE_LABEL: Record<Phase, string> = {
  planning: "Map",
  searching: "Map",
  reading: "Read",
  synthesizing: "Write",
};

function PhaseRail({ phase }: { phase: Phase }) {
  const currentIdx = PHASE_ORDER.indexOf(phase === "planning" ? "searching" : phase);
  return (
    <div
      className="flex items-center gap-2 font-mono text-[10px] uppercase"
      style={{ letterSpacing: "0.16em" }}
      aria-hidden
    >
      {PHASE_ORDER.map((p, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <Fragment key={p}>
            {i > 0 ? (
              <span
                className={cn(
                  "h-px w-3.5 transition-colors duration-500",
                  done ? "bg-primary/45" : "bg-border/60",
                )}
              />
            ) : null}
            <span
              className={cn(
                "transition-colors duration-500",
                active
                  ? "text-primary"
                  : done
                    ? "text-foreground/45"
                    : "text-muted-foreground/35",
              )}
            >
              {PHASE_LABEL[p]}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Activity stream — the agent's work, surfaced live                   */
/* ------------------------------------------------------------------ */

/** Parse the sources a single search step turned up, reusing the pool builder
 *  so arXiv + web outputs are handled identically to the final reading list. */
function sourcesForStep(name: string, output: string | undefined): PaperMeta[] {
  if (!output || (name !== "arxiv_search" && name !== "web_search")) return [];
  const step: AgentStep = { kind: "tool_call", id: "_", name, input: {}, output };
  return Array.from(buildPoolFromSteps([step]).byUrl.values());
}

/** One discovered source, surfaced inline as the agent finds it — a compact,
 *  scannable row that links straight out so an eager reader can jump ahead. */
function SourceRow({ p }: { p: PaperMeta }) {
  const kind = p.arxivId ? "Paper" : "Web";
  const inner = (
    <>
      <span className="mt-px shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/50">
        {kind}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-foreground/70 transition-colors group-hover/src:text-foreground">
        {p.title}
      </span>
      {p.year ? (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/45">
          {p.year}
        </span>
      ) : null}
      {p.url ? (
        <ArrowUpRight className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover/src:text-muted-foreground/60" />
      ) : null}
    </>
  );
  const className =
    "discover-row-in group/src -mx-1.5 flex items-baseline gap-2 rounded-md px-1.5 py-1";
  return p.url ? (
    <a
      href={p.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(className, "transition-colors hover:bg-muted/40")}
    >
      {inner}
    </a>
  ) : (
    <div className={className}>{inner}</div>
  );
}

/** The list of sources a search surfaced. Shows a peek by default and lets the
 *  reader expand the rest — the surfaced titles are what make the wait feel
 *  like progress rather than a spinner. */
function DiscoveredSources({ sources }: { sources: PaperMeta[] }) {
  const [expanded, setExpanded] = useState(false);
  if (sources.length === 0) return null;
  const PEEK = 3;
  const shown = expanded ? sources : sources.slice(0, PEEK);
  const rest = sources.length - PEEK;
  return (
    <div className="mt-1.5 space-y-px">
      {shown.map((p, i) => (
        <SourceRow key={`${p.arxivId ?? p.url ?? p.title}-${i}`} p={p} />
      ))}
      {!expanded && rest > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="-mx-1.5 px-1.5 py-1 text-[11px] font-medium text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          + {rest} more {rest === 1 ? "source" : "sources"}
        </button>
      ) : null}
    </div>
  );
}

/** One tool action's content. The spine marker is supplied by TimelineRow.
 *  Searches surface the sources they found inline; reads resolve the paper's
 *  title from the pool so "Reading · 2401.12345" reads as a real title. */
function ToolAction({
  name,
  input,
  output,
  pool,
  active,
}: {
  name: string;
  input: Record<string, unknown>;
  output?: string;
  pool: ReturnType<typeof buildPoolFromSteps>;
  active: boolean;
}) {
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

  // For a read, prefer the resolved paper title over the bare arXiv id.
  const arxivId = typeof input.arxivId === "string" ? input.arxivId : null;
  const readTitle =
    name === "paper_details" && arxivId
      ? pool.byArxivId.get(arxivId)?.title ?? null
      : null;
  const sources = sourcesForStep(name, output);

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[12.5px]">
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            active ? "text-primary/70" : "text-muted-foreground/55",
          )}
          strokeWidth={1.9}
        />
        <span
          className={cn(
            "font-medium",
            failed
              ? "text-destructive/90"
              : active
                ? "thinking-shimmer"
                : "text-foreground/85",
          )}
        >
          {verb} {displayName}
        </span>
        {readTitle ? (
          <span className="truncate text-foreground/70">· {readTitle}</span>
        ) : subject ? (
          <span className="truncate text-muted-foreground/65">· {subject}</span>
        ) : null}
        {count !== null ? (
          <span className="shrink-0 text-muted-foreground/55">
            · {count} found
          </span>
        ) : null}
      </div>
      {done && !failed ? <DiscoveredSources sources={sources} /> : null}
    </div>
  );
}

function RunningMarker() {
  // A calm breathing dot — no expanding halo, so it sits on the spine cleanly
  // and reads as one marker rather than a stray circle.
  return (
    <span
      className="block size-2 rounded-full bg-primary"
      style={{ animation: "discover-phase-pulse 1.4s ease-in-out infinite" }}
      aria-hidden
    />
  );
}
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
      <div className="min-w-0 flex-1 pb-4">{children}</div>
    </div>
  );
}

/** The agent's work — searches (with the sources they surface), reads, and
 *  thinking — as a living timeline. This IS the content while the agent is
 *  gathering: showing real titles arrive is what turns latency into progress. */
function WorkTimeline({
  steps,
  pool,
}: {
  steps: AgentStep[];
  pool: ReturnType<typeof buildPoolFromSteps>;
}) {
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
              marker={done ? doneMarker(failed) : <RunningMarker />}
            >
              <ToolAction
                name={step.name}
                input={step.input}
                output={step.output}
                pool={pool}
                active={!done}
              />
            </TimelineRow>
          );
        }
        return (
          <TimelineRow key={`th-${i}`} isLast={isLast} marker={THINKING_MARKER}>
            <span className="thinking-shimmer text-[12.5px] font-medium">
              Thinking through the approach
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

/** Before the first search returns there's nothing real to show yet — a quiet
 *  "setting up" line is more honest than fake result-shaped boxes. */
function PlanningState() {
  return (
    <div className="rounded-xl border border-dashed border-border/55 bg-card/20 px-4 py-5">
      <p className="thinking-shimmer text-[12.5px] font-medium">
        Scoping the question and lining up the first searches…
      </p>
      <div className="mt-3 flex items-center gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 rounded-full bg-primary/20"
            style={{
              width: i === 0 ? 64 : i === 1 ? 40 : 28,
              animation: `discover-phase-pulse 1.6s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The in-flight research run, presented as an agent visibly at work. While it's
 * gathering, the activity stream IS the content — every search and the real
 * source titles it turns up are surfaced as they arrive, so the wait reads as
 * progress (the deep-research pattern: show the work to hide the latency). The
 * moment the agent starts writing, focus shifts: the forming brief becomes the
 * star and the research trace recedes into a compact, expandable summary.
 */
export function DiscoverLiveProgress({ steps }: { steps: AgentStep[] }) {
  const progress = useMemo(() => deriveProgress(steps), [steps]);
  const pool = useMemo(() => buildPoolFromSteps(steps), [steps]);
  const [traceOpen, setTraceOpen] = useState(false);

  // Show the brief writing itself only once real prose has started streaming —
  // the phase flips to "synthesizing" the moment submit_picks is called, a beat
  // before the explainer text arrives, so gate on text to avoid an empty flash.
  const hasSynthesisText = useMemo(
    () => steps.some((s) => s.kind === "text" && s.text.trim().length > 0),
    [steps],
  );

  const searchCount = useMemo(
    () =>
      steps.filter(
        (s) =>
          s.kind === "tool_call" &&
          (s.name === "arxiv_search" || s.name === "web_search"),
      ).length,
    [steps],
  );
  const sourceCount = pool.byUrl.size;
  const hasWork = useMemo(
    () =>
      steps.some(
        (s) =>
          s.kind === "thinking" ||
          (s.kind === "tool_call" && s.name !== "submit_picks"),
      ),
    [steps],
  );

  return (
    <div className="space-y-4">
      {/* Header: a live narrative line + the Map → Read → Write phase rail.
          The single live "pulse" lives on the brief's title (see
          research-brief.tsx); this line stays dot-free so the left column
          reads as one clean text edge. */}
      <div className="flex items-baseline justify-between gap-4">
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/85"
          style={{ fontFamily: "var(--font-reading)" }}
        >
          {statusLine(progress)}
        </span>
        <div className="shrink-0">
          <PhaseRail phase={progress.phase} />
        </div>
      </div>

      {hasSynthesisText ? (
        <>
          {/* Writing: the brief is the star; the trace recedes to a summary. */}
          <LiveSynthesis steps={steps} pool={pool} />
          {hasWork ? (
            <div>
              <button
                type="button"
                onClick={() => setTraceOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    traceOpen && "rotate-90",
                  )}
                />
                {traceOpen ? "Hide research" : "Research"}
                {sourceCount > 0
                  ? ` · ${sourceCount} source${sourceCount === 1 ? "" : "s"} across ${searchCount} search${searchCount === 1 ? "" : "es"}`
                  : ""}
              </button>
              {traceOpen ? (
                <div className="mt-3">
                  <WorkTimeline steps={steps} pool={pool} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : hasWork ? (
        // Gathering: the activity stream is the content.
        <WorkTimeline steps={steps} pool={pool} />
      ) : (
        // Nothing has come back yet — a calm "setting up" state.
        <PlanningState />
      )}
    </div>
  );
}
