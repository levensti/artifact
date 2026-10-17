"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Globe,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import { EXA_KEY_REQUIRED_SENTINEL } from "@/tools/web-search";
import type { PaperMeta } from "@/lib/discover-paper-metadata";
import { buildPoolFromSteps } from "./picks-shared";
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

const TOOL_FAILED_RE =
  /^(?:error:|paper search failed:|web search failed:|request failed:|no papers found|no web results)/i;

/* ------------------------------------------------------------------ */
/*  Reading the step stream                                             */
/* ------------------------------------------------------------------ */

type ToolStep = Extract<AgentStep, { kind: "tool_call" }>;

function isSearch(s: AgentStep): s is ToolStep {
  return (
    s.kind === "tool_call" &&
    (s.name === "arxiv_search" || s.name === "web_search")
  );
}

function isRead(s: AgentStep): s is ToolStep {
  return s.kind === "tool_call" && s.name === "paper_details";
}

function submitIndex(steps: AgentStep[]): number {
  return steps.findIndex(
    (s) => s.kind === "tool_call" && s.name === "submit_picks",
  );
}

/**
 * The agent's working notes: text written between tool calls ("the searches
 * were noisy; let me verify…"). Text after `submit_picks` is the overview,
 * which is shown only once the brief is saved.
 */
function workingNotes(steps: AgentStep[]): string[] {
  const cut = submitIndex(steps);
  return steps.flatMap((s, i) =>
    s.kind === "text" && s.text.trim() && (cut === -1 || i < cut)
      ? [s.text.trim()]
      : [],
  );
}

/* ------------------------------------------------------------------ */
/*  Status — the brief's single live line                               */
/* ------------------------------------------------------------------ */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One line describing where the run is, shown under the brief's title. */
export function liveStatusLine(steps: AgentStep[]): string {
  if (submitIndex(steps) !== -1) return "Writing the overview";
  const reads = steps.filter(isRead);
  if (reads.length > 0) {
    const done = reads.filter((s) => !!s.output).length;
    return `Reading papers · ${plural(done, "paper", "papers")} checked`;
  }
  const searches = steps.filter(isSearch);
  if (searches.length > 0) {
    const found = searches.reduce(
      (n, s) => n + (resultCount(s.name, s.output) ?? 0),
      0,
    );
    return found > 0
      ? `Searching · ${plural(found, "source", "sources")} found`
      : "Searching";
  }
  return "Planning the search";
}

/* ------------------------------------------------------------------ */
/*  Research trace                                                     */
/* ------------------------------------------------------------------ */

/** Parse the sources a single search step turned up, reusing the pool builder
 *  so arXiv + web outputs are handled identically to the final reading list. */
function sourcesForStep(name: string, output: string | undefined): PaperMeta[] {
  if (!output || (name !== "arxiv_search" && name !== "web_search")) return [];
  const step: AgentStep = { kind: "tool_call", id: "_", name, input: {}, output };
  return Array.from(buildPoolFromSteps([step]).byUrl.values());
}

function StatusMark({ state }: { state: "running" | "done" | "failed" }) {
  if (state === "failed") {
    return <X className="size-3.5 text-destructive" strokeWidth={2.5} />;
  }
  if (state === "running") {
    return (
      <span
        className="block size-2 rounded-full bg-primary"
        style={{ animation: "discover-phase-pulse 1.4s ease-in-out infinite" }}
        aria-hidden
      />
    );
  }
  return <Check className="size-3.5 text-primary/70" strokeWidth={2.5} />;
}

function stepState(s: ToolStep): "running" | "done" | "failed" {
  if (!s.output) return "running";
  return TOOL_FAILED_RE.test(s.output.trim()) ? "failed" : "done";
}

/** A source a search surfaced: a plain linked title. These are candidates,
 *  not picks, so they stay quiet. */
function SourceRow({ p }: { p: PaperMeta }) {
  const inner = (
    <>
      {p.arxivId ? null : (
        <Globe
          className="size-3 shrink-0 self-center text-muted-foreground/60"
          strokeWidth={1.9}
          aria-label="Web"
        />
      )}
      <span className="min-w-0 flex-1 truncate">{p.title}</span>
      {p.year ? (
        <span className="shrink-0 tabular-nums text-muted-foreground/70">
          {p.year}
        </span>
      ) : null}
    </>
  );
  const className =
    "flex items-baseline gap-2 rounded-md px-2 py-1 text-[13px] text-muted-foreground";
  return p.url ? (
    <a
      href={p.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(className, "transition-colors hover:bg-muted/50 hover:text-foreground")}
    >
      {inner}
    </a>
  ) : (
    <div className={className}>{inner}</div>
  );
}

/** One search: the query and how much it found. Its results are candidates
 *  the agent mostly discards, so they stay folded until asked for. */
function SearchRow({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const state = stepState(step);
  const query = typeof step.input.query === "string" ? step.input.query : "";
  const count = resultCount(step.name, step.output);
  const sources = state === "done" ? sourcesForStep(step.name, step.output) : [];
  const Icon = step.name === "web_search" ? Globe : Search;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={sources.length === 0}
        aria-expanded={open}
        className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors enabled:hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StatusMark state={state} />
        </span>
        <Icon
          className="size-3.5 shrink-0 text-muted-foreground/70"
          strokeWidth={1.9}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[14px]",
            state === "running" ? "thinking-shimmer" : "text-foreground/85",
          )}
        >
          {query || "Search"}
        </span>
        <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
          {state === "failed"
            ? "Failed"
            : count !== null
              ? plural(count, "result", "results")
              : ""}
        </span>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-90",
            sources.length === 0 && "invisible",
          )}
        />
      </button>
      {open ? (
        <div className="mb-2 ml-[52px] mt-0.5">
          {sources.map((p, i) => (
            <SourceRow key={`${p.arxivId ?? p.url ?? p.title}-${i}`} p={p} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

/** A paper the agent opened to verify. These are the strongest signal in the
 *  trace, so they're listed first and at full weight. */
function ReadRow({
  step,
  pool,
}: {
  step: ToolStep;
  pool: ReturnType<typeof buildPoolFromSteps>;
}) {
  const state = stepState(step);
  const arxivId = typeof step.input.arxivId === "string" ? step.input.arxivId : null;
  const meta = arxivId ? pool.byArxivId.get(arxivId) : undefined;
  const title = meta?.title ?? (arxivId ? `arXiv:${arxivId}` : "Paper");
  const href = meta?.url ?? (arxivId ? `https://arxiv.org/abs/${arxivId}` : null);
  const label = (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-[14px]",
        state === "running"
          ? "thinking-shimmer"
          : state === "failed"
            ? "text-muted-foreground line-through"
            : "text-foreground/85",
      )}
    >
      {title}
    </span>
  );
  return (
    <li>
      <div className="group flex items-center gap-3 rounded-md px-2 py-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center">
          <StatusMark state={state} />
        </span>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 flex-1 items-center gap-2 hover:underline hover:decoration-border hover:underline-offset-4"
          >
            {label}
            <ArrowUpRight className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
          </a>
        ) : (
          label
        )}
        {meta?.year ? (
          <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
            {meta.year}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function TraceGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="px-2 text-[13px] font-medium text-muted-foreground">
        {title}
      </h3>
      <ul className="mt-1.5">{children}</ul>
    </div>
  );
}

/** What the agent is doing: papers checked first (the strong signal), then
 *  the searches behind them. Folded to a one-line summary so the page holds
 *  still while the run works; open it to watch. */
function ResearchTrace({
  steps,
  pool,
}: {
  steps: AgentStep[];
  pool: ReturnType<typeof buildPoolFromSteps>;
}) {
  const [open, setOpen] = useState(false);
  const searches = steps.filter(isSearch);
  const reads = steps.filter(isRead);
  const notes = workingNotes(steps);
  const latestNote = notes[notes.length - 1];
  if (searches.length === 0 && reads.length === 0) return null;

  const summary = [
    plural(searches.length, "search", "searches"),
    reads.length > 0 ? `${plural(reads.length, "paper", "papers")} checked` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-mx-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[15px] font-semibold tracking-[-0.01em] text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <ChevronRight
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
          strokeWidth={2}
        />
        Research
        <span className="text-[13px] font-normal text-muted-foreground">
          {summary}
        </span>
      </button>

      {open ? (
        <div className="mt-4 space-y-6">
          {latestNote ? (
            <p
              className="max-w-[68ch] border-l-2 border-border pl-4 text-[14px] leading-[1.6] text-muted-foreground"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              {latestNote}
            </p>
          ) : null}
          {reads.length > 0 ? (
            <TraceGroup title="Papers checked">
              {reads.map((s) => (
                <ReadRow key={s.id} step={s} pool={pool} />
              ))}
            </TraceGroup>
          ) : null}
          <TraceGroup title="Searches">
            {searches.map((s) => (
              <SearchRow key={s.id} step={s} />
            ))}
          </TraceGroup>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Live run                                                           */
/* ------------------------------------------------------------------ */

/**
 * The in-flight research run. Nothing streams into the page: the brief's
 * status line says what the agent is doing, this block holds a fixed place
 * for the result, and the research trace is folded unless the reader opens
 * it. The overview and reading list appear together once the run is saved.
 */
export function DiscoverLiveProgress({ steps }: { steps: AgentStep[] }) {
  const pool = useMemo(() => buildPoolFromSteps(steps), [steps]);
  const exaMissing = steps.some(
    (s) =>
      s.kind === "tool_call" &&
      s.name === "web_search" &&
      s.output?.trim() === EXA_KEY_REQUIRED_SENTINEL,
  );

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <p className="text-[15px] font-medium text-foreground">
          Researching your question
        </p>
        <p className="mx-auto mt-1.5 max-w-[440px] text-[14px] leading-relaxed text-muted-foreground">
          The overview and reading list will appear here when it&rsquo;s done,
          usually in a minute or two. You can keep working elsewhere in
          Artifact while it runs.
        </p>
      </div>

      {exaMissing ? <ExaKeyPromptCard /> : null}

      <ResearchTrace steps={steps} pool={pool} />
    </div>
  );
}
