"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Globe,
  MessageCircleQuestion,
  RotateCcw,
  Search,
  SearchX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { setRecommendationDismissed } from "@/lib/client-data";
import type { DiscoverQuery, Recommendation } from "@/lib/discover-types";
import type { AgentStep } from "@/hooks/use-chat";
import MarkdownMessage from "./markdown-message";
import { DiscoverLiveProgress, liveStatusLine } from "./discover-picks";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import {
  BriefSection,
  OverviewProse,
  ReadingList,
  picksCount,
} from "./brief-parts";

/* ------------------------------------------------------------------ */
/*  Notes helpers                                                      */
/* ------------------------------------------------------------------ */

function notesIndicateExaKeyMissing(notes: string | null | undefined): boolean {
  return !!notes && /exa key required/i.test(notes);
}

const ACTIVITY_MARKER = "**What I did:**";

/** Splits finalize notes into the agent's own message (a clarifying reply or
 *  explanation) and the appended "What I did" research log. Either may be
 *  empty. */
function splitNotes(notes: string | null | undefined): {
  prose: string;
  log: string | null;
} {
  if (!notes) return { prose: "", log: null };
  const idx = notes.indexOf(ACTIVITY_MARKER);
  if (idx === -1) return { prose: notes.trim(), log: null };
  return { prose: notes.slice(0, idx).trim(), log: notes.slice(idx).trim() || null };
}

/* ------------------------------------------------------------------ */
/*  Run data                                                           */
/* ------------------------------------------------------------------ */

/** Everything needed to render one research run (a root brief or a
 *  threaded follow-up). */
export interface BriefRunData {
  query: DiscoverQuery;
  recommendations: Recommendation[];
  dismissed: Recommendation[];
  acceptedCount: number;
  /** Set only while this run is in flight — drives the live progress view. */
  liveSteps?: AgentStep[];
}

/* ------------------------------------------------------------------ */
/*  Overview + research log                                            */
/* ------------------------------------------------------------------ */

/** A bare confirmation isn't a synthesis worth showing. */
function isTrivialSynthesis(prose: string): boolean {
  const t = prose.trim();
  return t.length === 0 || /^(picks submitted|submitted|done|here you go)[.!]?$/i.test(t);
}

/**
 * Older briefs saved every text segment the agent wrote, numbered ("1. the
 * searches were noisy… 2. <explainer>"). The explainer is always the last
 * segment (it's written after submit_picks), so show only that.
 */
function overviewFromProse(prose: string): string {
  if (!/^1\.\s/.test(prose) || !/\n\n2\.\s/.test(prose)) return prose;
  const segments = prose.split(/\n\n(?=\d+\.\s)/);
  return segments[segments.length - 1].replace(/^\d+\.\s+/, "").trim();
}

interface LogEntry {
  kind: "search" | "web" | "read";
  text: string;
  detail: string | null;
}

/** Parses the saved "What I did" log ("- Searched arXiv for “q” — 8 found",
 *  "- Read 1706.03762") back into rows. */
function parseLog(log: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const raw of log.split("\n")) {
    const line = raw.trim().replace(/^-\s*/, "");
    if (!line || line.startsWith("**")) continue;
    const search = line.match(
      /^Searched (arXiv|the web)(?: for “(.+)”)?(?: — (\d+) found)?/,
    );
    if (search) {
      entries.push({
        kind: search[1] === "arXiv" ? "search" : "web",
        text: search[2] ?? "Search",
        detail: search[3] !== undefined ? `${search[3]} results` : null,
      });
      continue;
    }
    const read = line.match(/^Read (.+)$/);
    if (read) {
      entries.push({ kind: "read", text: read[1], detail: null });
    }
  }
  return entries;
}

/** The finished brief's research trajectory, in the same shape as the live
 *  trace: papers checked first, then searches. Folded by default. */
function ResearchLog({
  log,
  recs,
}: {
  log: string;
  recs: Recommendation[];
}) {
  const [open, setOpen] = useState(false);
  const entries = parseLog(log);
  const reads = entries.filter((e) => e.kind === "read");
  const searches = entries.filter((e) => e.kind !== "read");
  if (entries.length === 0) return null;
  const titleFor = (id: string) =>
    recs.find((r) => r.arxivId === id)?.title ?? `arXiv:${id}`;
  const summary = [
    `${searches.length} ${searches.length === 1 ? "search" : "searches"}`,
    reads.length > 0
      ? `${reads.length} ${reads.length === 1 ? "paper" : "papers"} checked`
      : null,
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
          {reads.length > 0 ? (
            <div>
              <h3 className="px-2 text-[13px] font-medium text-muted-foreground">
                Papers checked
              </h3>
              <ul className="mt-1.5">
                {reads.map((e, i) => (
                  <li key={i}>
                    <a
                      href={`https://arxiv.org/abs/${e.text}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[14px] text-foreground/85 transition-colors hover:bg-muted/50"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {titleFor(e.text)}
                      </span>
                      <ArrowUpRight className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {searches.length > 0 ? (
            <div>
              <h3 className="px-2 text-[13px] font-medium text-muted-foreground">
                Searches
              </h3>
              <ul className="mt-1.5">
                {searches.map((e, i) => {
                  const Icon = e.kind === "web" ? Globe : Search;
                  return (
                    <li
                      key={i}
                      className="flex items-center gap-3 px-2 py-1.5 text-[14px]"
                    >
                      <Icon
                        className="size-3.5 shrink-0 text-muted-foreground/70"
                        strokeWidth={1.9}
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground/85">
                        {e.text}
                      </span>
                      {e.detail ? (
                        <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                          {e.detail}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DismissedList({ dismissed }: { dismissed: Recommendation[] }) {
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const restore = async (id: string) => {
    if (restoring) return;
    setRestoring(id);
    try {
      await setRecommendationDismissed(id, false);
      // Cache update fires DISCOVER_UPDATED_EVENT → the queue re-renders and
      // the pick moves back into the reading list.
    } catch {
      setRestoring(null);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        Dismissed ({dismissed.length})
      </button>
      {open ? (
        <div className="mt-1.5 space-y-1">
          {dismissed.map((rec) => (
            <div
              key={rec.id}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground line-through">
                {rec.title}
              </span>
              <button
                type="button"
                onClick={() => void restore(rec.id)}
                disabled={restoring !== null}
                className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
              >
                <RotateCcw className="size-3" strokeWidth={2} />
                Restore
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({
  query,
  dismissedCount,
  hasExaKey,
  onRetry,
}: {
  query: DiscoverQuery;
  dismissedCount: number;
  hasExaKey: boolean;
  onRetry?: (text: string) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  if (!hasExaKey && notesIndicateExaKeyMissing(query.notes)) {
    return <ExaKeyPromptCard queryText={query.query} />;
  }

  const { prose, log } = splitNotes(query.notes);
  const errored = query.status === "errored";

  const retryBtn =
    onRetry !== undefined ? (
      <button
        type="button"
        onClick={() => onRetry(query.query)}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
      >
        <RotateCcw className="size-3" strokeWidth={2.25} />
        Retry
      </button>
    ) : null;

  const detailsToggle = log ? (
    <button
      type="button"
      onClick={() => setShowDetails((v) => !v)}
      className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
    >
      {showDetails ? (
        <ChevronDown className="size-3" />
      ) : (
        <ChevronRight className="size-3" />
      )}
      {showDetails ? "Hide what I tried" : "Show what I tried"}
    </button>
  ) : null;

  const logBlock =
    showDetails && log ? (
      <div className="mt-2 rounded-md border border-border/40 bg-card/60 px-3 py-2 text-[12px]">
        <MarkdownMessage content={log} />
      </div>
    ) : null;

  // The agent replied with a message instead of picks (a clarification or
  // explanation). Lead with that message and invite a reply — don't bury it
  // as a "failure". The follow-up composer right below is how the user
  // answers.
  if (prose) {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex items-start gap-2.5">
          <MessageCircleQuestion
            className="mt-0.5 size-4 shrink-0 text-primary/70"
            strokeWidth={2}
          />
          <div className="min-w-0 flex-1">
            <div
              className="max-w-[68ch] text-[15px] leading-[1.65] text-foreground/90"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              <MarkdownMessage content={prose} />
            </div>
            <p
              className="mt-2 text-[13px] leading-relaxed text-muted-foreground"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              Reply below to point it in a direction, or retry for a best-effort
              list.
            </p>
            <div className="mt-2.5 flex items-center gap-3">
              {retryBtn}
              {detailsToggle}
            </div>
            {logBlock}
          </div>
        </div>
      </div>
    );
  }

  // No agent message — a genuine empty result, dismissal, or error.
  const allDismissed = !errored && dismissedCount > 0;
  const title = errored
    ? "This research run hit an error."
    : allDismissed
      ? "You've cleared everything from this brief."
      : log
        ? "I searched but couldn't assemble a ranked list this time."
        : "Nothing came back for this question.";
  const hint = errored
    ? "It usually goes through on a retry."
    : allDismissed
      ? null
      : "Retry, or rephrase to narrow the angle.";

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-muted-foreground/70">
          {errored ? (
            <AlertCircle className="size-4 text-destructive/70" strokeWidth={2} />
          ) : (
            <SearchX className="size-4" strokeWidth={2} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium leading-snug text-foreground">
            {title}
          </p>
          {hint ? (
            <p
              className="mt-1 text-[14px] leading-relaxed text-muted-foreground"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              {hint}
            </p>
          ) : null}
          <div className="mt-2.5 flex items-center gap-3">
            {!allDismissed ? retryBtn : null}
            {detailsToggle}
          </div>
          {logBlock}
        </div>
      </div>
    </div>
  );
}

/** Renders a single run's outcome: live progress, the finished brief, or a
 *  calm empty state. Live and finished share one shape (Overview, Reading
 *  list, Research) so a run completing doesn't rearrange the page. */
function RunBody({
  run,
  hasExaKey,
  onRetry,
}: {
  run: BriefRunData;
  hasExaKey: boolean;
  onRetry?: (text: string) => void;
}) {
  if (run.liveSteps) {
    return <DiscoverLiveProgress steps={run.liveSteps} />;
  }

  const { query, recommendations, dismissed } = run;

  if (recommendations.length === 0) {
    return (
      <EmptyState
        query={query}
        dismissedCount={dismissed.length}
        hasExaKey={hasExaKey}
        onRetry={onRetry}
      />
    );
  }

  const { prose, log } = splitNotes(query.notes);
  const synthesis =
    prose && !isTrivialSynthesis(prose) ? overviewFromProse(prose) : null;

  return (
    <div className="space-y-12">
      {synthesis ? (
        <BriefSection title="Overview">
          <OverviewProse prose={synthesis} />
        </BriefSection>
      ) : null}

      <BriefSection
        title="Reading list"
        count={picksCount(recommendations.length)}
      >
        <ReadingList recs={recommendations} />
        {dismissed.length > 0 ? (
          <div className="mt-3">
            <DismissedList dismissed={dismissed} />
          </div>
        ) : null}
      </BriefSection>

      {log ? <ResearchLog log={log} recs={recommendations} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Research brief                                                     */
/* ------------------------------------------------------------------ */

/** The status line under a question: live progress, or when it ran and
 *  what came of it. */
function RunStatus({ run, large }: { run: BriefRunData; large?: boolean }) {
  const { query } = run;
  const picks = run.recommendations.length;
  const accepted = run.acceptedCount;
  const parts: string[] = [];
  if (run.liveSteps) {
    return (
      <p
        className={cn(
          "flex items-center gap-2 text-primary",
          large ? "mt-3 text-[14px]" : "mt-1.5 text-[13px]",
        )}
      >
        <span className="landing-pulse-dot" aria-hidden />
        {liveStatusLine(run.liveSteps)}
      </p>
    );
  }
  parts.push(
    new Date(query.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year:
        new Date(query.createdAt).getFullYear() === new Date().getFullYear()
          ? undefined
          : "numeric",
    }),
  );
  if (picks > 0) parts.push(picksCount(picks));
  if (accepted > 0) parts.push(`${accepted} in library`);
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 text-muted-foreground",
        large ? "mt-3 text-[14px]" : "mt-1.5 text-[13px]",
      )}
      title={new Date(query.createdAt).toLocaleString()}
    >
      {parts.join(" · ")}
      {query.status === "errored" ? (
        <span className="inline-flex items-center gap-1 text-destructive/85">
          <AlertCircle className="size-3.5" strokeWidth={2} />
          Errored
        </span>
      ) : null}
    </p>
  );
}

/** A follow-up continues the brief below it: its question as a heading, then
 *  the same sections as the brief it refines. */
function FollowupRun({
  run,
  hasExaKey,
  onRetry,
}: {
  run: BriefRunData;
  hasExaKey: boolean;
  onRetry?: (text: string) => void;
}) {
  return (
    <section className="border-t border-border pt-12">
      <p className="text-[13px] font-medium text-muted-foreground">Follow-up</p>
      <h2 className="mt-1 text-[21px] font-semibold leading-snug tracking-[-0.015em] text-foreground">
        {run.query.query}
      </h2>
      <RunStatus run={run} />
      <div className="mt-8">
        <RunBody run={run} hasExaKey={hasExaKey} onRetry={onRetry} />
      </div>
    </section>
  );
}

export default function ResearchBrief({
  run,
  followups,
  hasExaKey,
  onRetry,
}: {
  run: BriefRunData;
  followups: BriefRunData[];
  hasExaKey: boolean;
  /** Re-run a query that came back empty or errored. */
  onRetry: (text: string) => void;
}) {
  return (
    <article>
      <header>
        <h1 className="max-w-[30ch] text-[30px] font-semibold leading-[1.2] tracking-[-0.025em] text-foreground">
          {run.query.query}
        </h1>
        <RunStatus run={run} large />
      </header>

      <div className="mt-10 space-y-12">
        <RunBody run={run} hasExaKey={hasExaKey} onRetry={onRetry} />
        {followups.map((f) => (
          <FollowupRun
            key={f.query.id}
            run={f}
            hasExaKey={hasExaKey}
            onRetry={onRetry}
          />
        ))}
      </div>
    </article>
  );
}
