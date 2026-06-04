"use client";

import { useState, type KeyboardEvent } from "react";
import {
  AlertCircle,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  MessageCircleQuestion,
  RotateCcw,
  SearchX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { setRecommendationDismissed } from "@/lib/client-data";
import type { DiscoverQuery, Recommendation } from "@/lib/discover-types";
import type { AgentStep } from "@/hooks/use-chat";
import MarkdownMessage from "./markdown-message";
import RecommendationCard from "./recommendation-card";
import { DiscoverLiveProgress } from "./discover-picks";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import { MonoLabel } from "./folio";

/* ------------------------------------------------------------------ */
/*  Time + notes helpers                                               */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

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
/*  Synthesis + reading list + disclosures                             */
/* ------------------------------------------------------------------ */

/** A bare confirmation isn't a synthesis worth showing. */
function isTrivialSynthesis(prose: string): boolean {
  const t = prose.trim();
  return t.length === 0 || /^(picks submitted|submitted|done|here you go)[.!]?$/i.test(t);
}

function Synthesis({ prose }: { prose: string }) {
  return (
    <div className="rounded-lg border border-primary/15 bg-primary/[0.03] px-3.5 py-3">
      <div className="mb-1.5">
        <MonoLabel tone="accent">What I found</MonoLabel>
      </div>
      <div className="text-[13px] leading-relaxed">
        <MarkdownMessage content={prose} />
      </div>
    </div>
  );
}

/** The agent's research trajectory — searches run, papers read — rendered
 *  from the persisted "What I did" log. Collapsed by default; this is the
 *  "how it got here" transparency for a finished brief. */
function ResearchLog({ log }: { log: string }) {
  const [open, setOpen] = useState(false);
  const body = log.replace(ACTIVITY_MARKER, "").trim();
  const steps = body
    .split("\n")
    .filter((l) => l.trim().startsWith("-")).length;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/75 transition-colors hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        How I researched{steps > 0 ? ` · ${steps} step${steps === 1 ? "" : "s"}` : ""}
      </button>
      {open ? (
        <div className="mt-1.5 rounded-md border border-border/40 bg-card/60 px-3 py-2 text-[12px]">
          <MarkdownMessage content={body} />
        </div>
      ) : null}
    </div>
  );
}

function ReadingList({ recs }: { recs: Recommendation[] }) {
  return (
    <div className="space-y-2">
      <MonoLabel>Reading list</MonoLabel>
      <div className="grid grid-cols-1 gap-2">
        {recs.map((rec) => (
          <RecommendationCard key={rec.id} rec={rec} />
        ))}
      </div>
    </div>
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
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/75 transition-colors hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
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
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground line-through">
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
        className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11.5px] font-medium text-primary transition-colors hover:bg-primary/15"
      >
        <RotateCcw className="size-3" strokeWidth={2.25} />
        Retry
      </button>
    ) : null;

  const detailsToggle = log ? (
    <button
      type="button"
      onClick={() => setShowDetails((v) => !v)}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
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
      <div className="rounded-lg border border-border/50 bg-muted/15 px-3.5 py-3">
        <div className="flex items-start gap-2.5">
          <MessageCircleQuestion
            className="mt-0.5 size-4 shrink-0 text-primary/70"
            strokeWidth={2}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] leading-relaxed text-foreground/90">
              <MarkdownMessage content={prose} />
            </div>
            <p
              className="mt-2 text-[12px] leading-relaxed text-muted-foreground"
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
    <div className="rounded-lg border border-border/50 bg-muted/15 px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-muted-foreground/70">
          {errored ? (
            <AlertCircle className="size-4 text-destructive/70" strokeWidth={2} />
          ) : (
            <SearchX className="size-4" strokeWidth={2} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug text-foreground/90">
            {title}
          </p>
          {hint ? (
            <p
              className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground"
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

/** Renders a single run's outcome: live progress, or the finished brief
 *  body (synthesis → reading list → dismissed), or a calm empty state. */
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
  const synthesis = prose && !isTrivialSynthesis(prose) ? prose : null;

  return (
    <div className="space-y-4">
      {synthesis ? <Synthesis prose={synthesis} /> : null}
      {log ? <ResearchLog log={log} /> : null}
      <ReadingList recs={recommendations} />
      {dismissed.length > 0 ? <DismissedList dismissed={dismissed} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Follow-up                                                          */
/* ------------------------------------------------------------------ */

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
    <div className="ml-1 space-y-2 border-l-2 border-border/60 pl-3.5">
      <div className="flex items-start gap-1.5">
        <CornerDownRight
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/55"
          strokeWidth={2}
        />
        <p
          className="text-[13px] font-semibold leading-snug text-foreground"
          style={{ fontFamily: "var(--font-reading)" }}
        >
          {run.query.query}
        </p>
      </div>
      <div className="pl-5">
        <RunBody run={run} hasExaKey={hasExaKey} onRetry={onRetry} />
      </div>
    </div>
  );
}

function FollowupComposer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const canSend = !disabled && text.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    const trimmed = text.trim();
    setText("");
    onSubmit(trimmed);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex items-end gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Ask a follow-up — go deeper, narrow the scope, compare…"
        rows={1}
        disabled={disabled}
        className="min-h-[22px] flex-1 resize-none bg-transparent text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/55 focus:outline-none disabled:cursor-not-allowed"
        style={{ fontFamily: "var(--font-reading)" }}
      />
      <button
        type="button"
        onClick={send}
        disabled={!canSend}
        aria-label="Send follow-up"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
          canSend
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "text-muted-foreground/40",
        )}
      >
        <ArrowUp className="size-3.5" strokeWidth={2.25} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Research brief                                                     */
/* ------------------------------------------------------------------ */

export default function ResearchBrief({
  run,
  followups,
  defaultCollapsed,
  pinned = false,
  hasExaKey,
  canFollowup,
  followupBusy,
  onFollowup,
  onRetry,
}: {
  run: BriefRunData;
  followups: BriefRunData[];
  defaultCollapsed: boolean;
  /** Focus view: always-open, no collapse chrome. */
  pinned?: boolean;
  hasExaKey: boolean;
  /** Whether follow-ups can be submitted (a usable model key exists). */
  canFollowup: boolean;
  /** A run is currently streaming — pause the follow-up composer. */
  followupBusy: boolean;
  onFollowup: (parentId: string, text: string) => void;
  /** Re-run a query that came back empty or errored. */
  onRetry: (text: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const { query } = run;
  const isLive = !!run.liveSteps;
  const accepted = run.acceptedCount;
  const open = pinned || !collapsed;

  const meta = (
    <span className="min-w-0 flex-1">
      <span
        className={cn(
          "block font-semibold leading-snug tracking-[-0.01em] text-foreground",
          pinned ? "text-[19px]" : "text-[15px]",
        )}
      >
        {query.query}
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span title={new Date(query.createdAt).toLocaleString()}>
          {isLive ? "Researching now" : relativeTime(query.createdAt)}
        </span>
        {!isLive && run.recommendations.length > 0 ? (
          <>
            <span aria-hidden>·</span>
            <span>
              {run.recommendations.length} pick
              {run.recommendations.length === 1 ? "" : "s"}
              {accepted > 0 ? ` · ${accepted} in library` : ""}
            </span>
          </>
        ) : null}
        {query.status === "errored" ? (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-0.5 text-destructive/85">
              <AlertCircle className="size-3" strokeWidth={2} />
              errored
            </span>
          </>
        ) : null}
      </span>
    </span>
  );

  return (
    <section
      className={cn(
        pinned
          ? ""
          : "rounded-xl border border-border/60 bg-card/40 px-4 py-3.5",
      )}
      style={pinned ? undefined : { animation: "fadeIn 220ms ease-out" }}
    >
      <header>
        {pinned ? (
          <div className="flex items-start gap-2">
            {isLive ? (
              <span className="landing-pulse-dot mt-2 block shrink-0" />
            ) : null}
            {meta}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex w-full items-start gap-2 text-left"
          >
            <span className="mt-0.5 shrink-0 text-muted-foreground/60">
              {isLive ? (
                <span className="landing-pulse-dot mt-1 block" />
              ) : collapsed ? (
                <ChevronRight className="size-4" strokeWidth={2} />
              ) : (
                <ChevronDown className="size-4" strokeWidth={2} />
              )}
            </span>
            {meta}
          </button>
        )}
      </header>

      {open ? (
        <div className="mt-3.5 space-y-4">
          <RunBody run={run} hasExaKey={hasExaKey} onRetry={onRetry} />

          {followups.map((f) => (
            <FollowupRun
              key={f.query.id}
              run={f}
              hasExaKey={hasExaKey}
              onRetry={onRetry}
            />
          ))}

          {canFollowup ? (
            <FollowupComposer
              disabled={followupBusy}
              onSubmit={(t) => onFollowup(query.id, t)}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
