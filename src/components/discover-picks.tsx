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
import { canonicalUrl, type PaperMeta } from "@/lib/discover-paper-metadata";
import { normalizeArxivId } from "@/lib/arxiv";
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

/** The funnel's screening step (see src/server/discover-funnel.ts). */
function isScreen(s: AgentStep): s is ToolStep {
  return s.kind === "tool_call" && s.name === "screen_sources";
}

/** "Screened 124 sources. Shortlisted 18 …" → the two counts. */
function screenCounts(step: ToolStep): { screened: number; shortlisted: number | null } {
  const total = Number(step.input.candidates) || 0;
  const out = step.output ?? "";
  const screened = Number(out.match(/Screened (\d+)/)?.[1] ?? total);
  const shortlisted = out.match(/Shortlisted (\d+)/)?.[1];
  return { screened, shortlisted: shortlisted ? Number(shortlisted) : null };
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

/** Under a running brief's question: the step log below says what's
 *  happening, so this only sets expectations. */
export const LIVE_RUN_NOTE =
  "Usually takes a minute or two. You can keep working elsewhere in Artifact.";

/** One line describing where the run is, for places that show a running
 *  brief without its step log (the project overview). */
export function liveStatusLine(steps: AgentStep[]): string {
  if (submitIndex(steps) !== -1) return "Writing the overview";
  const reads = steps.filter(isRead);
  if (reads.length > 0 && reads.some((s) => !s.output)) {
    return "Reading the strongest papers closely";
  }
  const screenStep = steps.find(isScreen);
  if (screenStep) {
    return screenStep.output
      ? "Choosing the reading list"
      : `Grading ${plural(screenCounts(screenStep).screened, "source", "sources")}`;
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

/* ------------------------------------------------------------------ */
/*  Shortlist data                                                     */
/* ------------------------------------------------------------------ */

/** A scored source on the shortlist (attached to the screening step). */
interface ShortlistEntry {
  arxivId: string | null;
  url: string;
  score: number;
}

function shortlistOf(step: ToolStep | undefined): ShortlistEntry[] {
  const raw = step?.input.shortlist;
  return Array.isArray(raw) ? (raw as ShortlistEntry[]) : [];
}

/** The picks the agent submitted, as match keys (arXiv id or canonical URL). */
function pickedKeys(steps: AgentStep[]): Set<string> | null {
  const i = submitIndex(steps);
  if (i === -1) return null;
  const picks = (steps[i] as ToolStep).input.picks;
  const keys = new Set<string>();
  if (Array.isArray(picks)) {
    for (const p of picks as Array<{ arxivId?: string; url?: string }>) {
      if (p.arxivId) keys.add(`arxiv:${normalizeArxivId(p.arxivId)}`);
      if (p.url) keys.add(`url:${canonicalUrl(p.url)}`);
    }
  }
  return keys;
}

function entryKeys(e: { arxivId: string | null; url: string }): string[] {
  return [
    e.arxivId ? `arxiv:${normalizeArxivId(e.arxivId)}` : null,
    e.url ? `url:${canonicalUrl(e.url)}` : null,
  ].filter((k): k is string => k !== null);
}

/** How many picks the agent submitted. */
function pickCount(steps: AgentStep[]): number {
  const i = submitIndex(steps);
  const picks = i === -1 ? null : (steps[i] as ToolStep).input.picks;
  return Array.isArray(picks) ? picks.length : 0;
}

/* ------------------------------------------------------------------ */
/*  Shortlist: the graded sources, and the agent choosing from them    */
/* ------------------------------------------------------------------ */

/**
 * The sources that cleared grading, best first, each with its relevance
 * score as a bar. Once the agent submits its reading list, the picks are
 * marked and the rest step back, so the reader watches the choice land.
 */
function Shortlist({
  steps,
  pool,
}: {
  steps: AgentStep[];
  pool: ReturnType<typeof buildPoolFromSteps>;
}) {
  const screenStep = steps.find(isScreen);
  const entries = shortlistOf(screenStep);
  const picked = pickedKeys(steps);
  const byKey = useMemo(() => {
    const map = new Map<string, PaperMeta>();
    for (const [id, meta] of pool.byArxivId) map.set(`arxiv:${normalizeArxivId(id)}`, meta);
    for (const [url, meta] of pool.byUrl) map.set(`url:${url}`, meta);
    return map;
  }, [pool]);
  if (entries.length === 0) return null;
  const ranked = [...entries].sort((a, b) => b.score - a.score);

  return (
    <section>
      <ol>
        {ranked.map((e) => {
          const keys = entryKeys(e);
          const meta = keys.map((k) => byKey.get(k)).find(Boolean);
          const isPick = !!picked && keys.some((k) => picked.has(k));
          const title = meta?.title ?? (e.arxivId ? `arXiv:${e.arxivId}` : e.url);
          const href = meta?.url ?? e.url;
          return (
            <li key={keys[0] ?? e.url}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "group grid grid-cols-[16px_minmax(0,1fr)_88px] items-center gap-3 rounded-md px-2 py-1.5 transition-[background-color,opacity] duration-300 hover:bg-muted/50",
                  picked && !isPick && "opacity-45",
                )}
              >
                <span className="flex items-center justify-center">
                  {isPick ? (
                    <Check className="size-3.5 text-primary" strokeWidth={2.5} aria-label="Picked" />
                  ) : meta && !meta.arxivId ? (
                    <Globe className="size-3 text-muted-foreground/60" strokeWidth={1.9} aria-label="Web" />
                  ) : null}
                </span>
                <span
                  className={cn(
                    "truncate text-[14px]",
                    isPick ? "font-medium text-foreground" : "text-foreground/85",
                  )}
                >
                  {title}
                  {meta?.year ? (
                    <span className="ml-2 text-[13px] tabular-nums text-muted-foreground">
                      {meta.year}
                    </span>
                  ) : null}
                </span>
                <span
                  className="flex items-center gap-2"
                  title={`Relevance ${e.score.toFixed(2)}`}
                >
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-border/70">
                    <span
                      className={cn("block h-full rounded-full", isPick ? "bg-primary" : "bg-primary/45")}
                      style={{ width: `${Math.round(Math.max(0, Math.min(1, e.score)) * 100)}%` }}
                    />
                  </span>
                  <span className="w-7 text-right text-[12px] tabular-nums text-muted-foreground">
                    {e.score.toFixed(2)}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Live run                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Research log: the run as a sequence of steps                       */
/* ------------------------------------------------------------------ */

type StepState = "done" | "active" | "pending";

/** Searches listed before "Show all": the newest, where the action is. */
const SEARCHES_SHOWN = 6;

export function StepMarker({ state }: { state: StepState }) {
  if (state === "done") {
    return <Check className="size-3.5 text-primary/80" strokeWidth={2.5} aria-hidden />;
  }
  if (state === "active") {
    return (
      <span
        aria-hidden
        className="block size-2 rounded-full bg-primary"
        style={{ animation: "discover-phase-pulse 1.4s ease-in-out infinite" }}
      />
    );
  }
  return <span aria-hidden className="block size-[7px] rounded-full border border-muted-foreground/40" />;
}

/**
 * One step on the rail. The current step opens its details; finished steps
 * fold to their one-line account and can be reopened; upcoming steps say
 * what will happen.
 */
export function LogStep({
  state,
  title,
  last,
  children,
  stayOpen,
}: {
  state: StepState;
  title: string;
  last?: boolean;
  /** Details: shown while the step is current, on request once it's done. */
  children?: ReactNode;
  /** Keep the details open after the step finishes (the shortlist). */
  stayOpen?: boolean;
}) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const hasDetails = !!children && state !== "pending";
  const open =
    hasDetails && (toggled ?? (state === "active" || (state === "done" && !!stayOpen)));
  const titleClass = cn(
    "text-[15px] leading-snug",
    state === "active"
      ? "font-medium text-primary"
      : state === "done"
        ? "text-foreground"
        : "text-muted-foreground",
  );
  return (
    <li className={cn("relative pl-8", last ? "" : "pb-6")}>
      {!last ? (
        <span
          aria-hidden
          className={cn(
            "absolute left-[7px] top-6 bottom-1 w-px",
            state === "done" ? "bg-primary/35" : "bg-border",
          )}
        />
      ) : null}
      <span className="absolute left-0 top-[3px] flex size-[15px] items-center justify-center">
        <StepMarker state={state} />
      </span>
      {hasDetails && state === "done" ? (
        <button
          type="button"
          onClick={() => setToggled(!open)}
          aria-expanded={open}
          className={cn(
            "-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
            titleClass,
          )}
        >
          {title}
          <ChevronRight
            className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")}
            strokeWidth={2}
          />
        </button>
      ) : (
        <p className={titleClass}>{title}</p>
      )}
      {open ? <div className="mt-3">{children}</div> : null}
    </li>
  );
}

function SearchList({ searches }: { searches: ToolStep[] }) {
  const [showAll, setShowAll] = useState(false);
  const newest = [...searches].reverse();
  const shown = showAll ? newest : newest.slice(0, SEARCHES_SHOWN);
  return (
    <ul className="-ml-2">
      {shown.map((s) => (
        <SearchRow key={s.id} step={s} />
      ))}
      {newest.length > SEARCHES_SHOWN ? (
        <li>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-1 rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            {showAll ? "Show fewer" : `Show all ${newest.length} searches`}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The in-flight research run as a log of its steps (plan, search, grade,
 * choose, write; see src/server/discover-funnel.ts). Every step is on the
 * rail from the start, so the page shows the whole route even while it's
 * planning; each step's line fills in with what it did, and the current
 * step opens its details. The overview and reading list replace this once
 * the run is saved.
 */
export function DiscoverLiveProgress({ steps }: { steps: AgentStep[] }) {
  const pool = useMemo(() => buildPoolFromSteps(steps), [steps]);
  const exaMissing = steps.some(
    (s) =>
      s.kind === "tool_call" &&
      s.name === "web_search" &&
      s.output?.trim() === EXA_KEY_REQUIRED_SENTINEL,
  );

  const searches = steps.filter(isSearch);
  const searchesDone = searches.filter((s) => !!s.output).length;
  const found = searches.reduce((n, s) => n + (resultCount(s.name, s.output) ?? 0), 0);
  const screenStep = steps.find(isScreen);
  const screen = screenStep ? screenCounts(screenStep) : null;
  const reads = steps.filter(isRead);
  const hasShortlist = shortlistOf(screenStep).length > 0;
  const picks = pickedKeys(steps) ? pickCount(steps) : null;
  const notes = workingNotes(steps);
  const latestNote = notes[notes.length - 1];

  // The furthest step reached; earlier steps are done.
  const reached =
    picks !== null ? 4 : screenStep?.output ? 3 : screenStep ? 2 : searches.length > 0 ? 1 : 0;
  const state = (i: number): StepState =>
    i < reached ? "done" : i === reached ? "active" : "pending";

  const note = latestNote ? (
    <p
      className="mb-3 max-w-[64ch] border-l-2 border-primary/30 pl-3 text-[14px] leading-[1.65] text-foreground/75"
      style={{ fontFamily: "var(--font-reading)" }}
    >
      {latestNote}
    </p>
  ) : null;

  const searchTitle =
    state(1) === "pending"
      ? "Search papers and the web"
      : state(1) === "active"
        ? `Searching · ${searchesDone} of ${searches.length} done${found > 0 ? `, ${plural(found, "result", "results")}` : ""}`
        : `Searched ${searches.length} ways, ${plural(found, "result", "results")}`;
  const gradeTitle = !screen
    ? "Grade every source on its content"
    : screenStep?.output
      ? `Graded ${plural(screen.screened, "unique source", "unique sources")}, kept the best ${screen.shortlisted ?? 0}`
      : `Grading ${plural(screen.screened, "unique source", "unique sources")} on their content`;
  const chooseTitle =
    picks !== null
      ? `Picked ${picks} for the reading list`
      : state(3) === "active"
        ? reads.some((r) => !r.output)
          ? "Reading the strongest papers closely"
          : "Choosing the reading list from the shortlist"
        : "Choose the reading list";

  return (
    <div className="space-y-6">
      {exaMissing ? <ExaKeyPromptCard /> : null}
      <ol aria-label="Research steps">
        <LogStep
          state={state(0)}
          title={state(0) === "active" ? "Planning the searches" : `Planned ${plural(searches.length, "search", "searches")}`}
        />
        <LogStep state={state(1)} title={searchTitle}>
          {state(1) === "active" ? note : null}
          {searches.length > 0 ? <SearchList searches={searches} /> : null}
        </LogStep>
        <LogStep state={state(2)} title={gradeTitle} />
        <LogStep state={state(3)} title={chooseTitle} stayOpen>
          {state(3) === "active" ? note : null}
          {hasShortlist ? <Shortlist steps={steps} pool={pool} /> : null}
          {reads.length > 0 ? (
            <div className="mt-4">
              <TraceGroup title="Read closely">
                {reads.map((s) => (
                  <ReadRow key={s.id} step={s} pool={pool} />
                ))}
              </TraceGroup>
            </div>
          ) : null}
        </LogStep>
        <LogStep
          state={state(4)}
          title={state(4) === "active" ? "Writing the overview" : "Write the overview"}
          last
        />
      </ol>
    </div>
  );
}
