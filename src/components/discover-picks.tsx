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
import type { Recommendation } from "@/lib/discover-types";
import { BriefSection, OverviewProse, ReadingList, picksCount } from "./brief-parts";

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
 * The agent writes two kinds of text: working notes between tool calls ("the
 * searches were noisy; let me verify…") and, after `submit_picks`, the
 * explainer that is the brief's overview. They're different content and are
 * shown in different places, so split them here.
 */
function splitText(steps: AgentStep[]): { notes: string[]; explainer: string } {
  const cut = submitIndex(steps);
  const notes: string[] = [];
  const explainer: string[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== "text" || !s.text.trim()) return;
    if (cut !== -1 && i > cut) explainer.push(s.text);
    else notes.push(s.text.trim());
  });
  return { notes, explainer: explainer.join("\n\n").trim() };
}

/** Picks from the `submit_picks` call, shaped like saved recommendations so
 *  the reading list can show them before the run is finalized. */
function livePicks(
  steps: AgentStep[],
  pool: ReturnType<typeof buildPoolFromSteps>,
): Recommendation[] {
  const cut = submitIndex(steps);
  if (cut === -1) return [];
  const step = steps[cut] as ToolStep;
  const raw = step.input?.picks;
  if (!Array.isArray(raw)) return [];
  const out: Recommendation[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const p = item as Record<string, unknown>;
    const url = typeof p.url === "string" ? p.url.trim() : "";
    const title = typeof p.title === "string" ? p.title.trim() : "";
    if (!url || !title) return;
    const arxivId =
      typeof p.arxivId === "string" && p.arxivId.trim() ? p.arxivId.trim() : null;
    const meta = arxivId ? pool.byArxivId.get(arxivId) : undefined;
    const year = meta?.year ? Number(meta.year) : null;
    out.push({
      id: `live-${i}`,
      queryId: "live",
      rank: out.length + 1,
      url,
      title,
      rationale: typeof p.rationale === "string" ? p.rationale.trim() : "",
      arxivId,
      authors:
        typeof p.authors === "string" ? p.authors : meta?.authors || null,
      publishedDate: meta?.publishedDate ?? null,
      publishedYear: year && Number.isInteger(year) ? year : null,
      venue: null,
      citationCount: null,
      dismissedAt: null,
      createdAt: "",
    });
  });
  return out;
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

/** How the run got its answer: papers checked first (the strong signal), then
 *  the searches behind them. Open while the agent is gathering, since it's the
 *  only content then; it folds to a one-line summary once the brief is being
 *  written, unless the reader opens it. */
function ResearchTrace({
  steps,
  pool,
  gathering,
}: {
  steps: AgentStep[];
  pool: ReturnType<typeof buildPoolFromSteps>;
  gathering: boolean;
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? gathering;
  const searches = steps.filter(isSearch);
  const reads = steps.filter(isRead);
  const { notes } = splitText(steps);
  const latestNote = gathering ? notes[notes.length - 1] : undefined;
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
        onClick={() => setUserOpen(!open)}
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
 * The in-flight research run. It has the same shape as a finished brief
 * (Overview, Reading list, Research) so nothing jumps when it completes.
 * While gathering, the research trace is the content. Once the agent submits
 * its picks, the reading list appears, the overview streams in, and the trace
 * folds away.
 */
export function DiscoverLiveProgress({ steps }: { steps: AgentStep[] }) {
  const pool = useMemo(() => buildPoolFromSteps(steps), [steps]);
  const picks = useMemo(() => livePicks(steps, pool), [steps, pool]);
  const { explainer } = useMemo(() => splitText(steps), [steps]);
  const exaMissing = steps.some(
    (s) =>
      s.kind === "tool_call" &&
      s.name === "web_search" &&
      s.output?.trim() === EXA_KEY_REQUIRED_SENTINEL,
  );
  const gathering = submitIndex(steps) === -1;
  const hasWork = steps.some((s) => isSearch(s) || isRead(s));

  return (
    <div className="space-y-12">
      {!gathering ? (
        <BriefSection title="Overview">
          {explainer ? (
            <OverviewProse prose={explainer} />
          ) : (
            // The status line already says it's writing; hold the space with
            // the rough shape of a paragraph instead of saying it again.
            <div className="max-w-[68ch] space-y-3 pt-1.5" aria-hidden>
              {["100%", "96%", "62%"].map((w) => (
                <div
                  key={w}
                  className="h-3 rounded-full bg-muted"
                  style={{
                    width: w,
                    animation: "discover-phase-pulse 1.6s ease-in-out infinite",
                  }}
                />
              ))}
            </div>
          )}
        </BriefSection>
      ) : null}

      {picks.length > 0 ? (
        <BriefSection title="Reading list" count={picksCount(picks.length)}>
          <ReadingList recs={picks} pending />
        </BriefSection>
      ) : null}

      {exaMissing ? <ExaKeyPromptCard /> : null}

      {hasWork ? (
        <ResearchTrace steps={steps} pool={pool} gathering={gathering} />
      ) : (
        <p className="text-[14px] text-muted-foreground">
          Searches and the papers they turn up will appear here.
        </p>
      )}
    </div>
  );
}
