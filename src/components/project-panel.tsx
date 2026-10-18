"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  FileText,
  Globe,
  MoreHorizontal,
  Pencil,
  Square,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ensureDiscoverLoaded,
  getDiscoverQueriesSnapshot,
  getRecommendationsSnapshot,
  getReviewsSnapshot,
  hydrateClientStore,
  judgeBriefs,
} from "@/lib/client-data";
import { orderByJudge } from "@/lib/judge-rubric";
import { hasUsableProvider } from "@/lib/keys";
import { normalizeArxivId } from "@/lib/arxiv";
import { buildFollowupPrompt, linkThread } from "@/lib/discover-threads";
import {
  followupQuestion,
  researchOptions,
} from "@/lib/project-research-client";
import type { Recommendation } from "@/lib/discover-types";
import type { PaperReview } from "@/lib/review-types";
import { useDiscoverChat } from "@/hooks/use-discover-chat";
import { takePendingResearch } from "@/lib/pending-research";
import {
  DiscoverLiveProgress,
  LIVE_RUN_NOTE,
  liveStatusLine,
} from "./discover-picks";
import { useProjects } from "@/hooks/use-projects";
import { useDiscoverBriefs, type ThreadView } from "./discover-queue";
import { BriefSection } from "./brief-parts";
import RecommendationCard from "./recommendation-card";
import ResearchBrief from "./research-brief";
import ResearchComposer from "./research-composer";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import { ExaKeyResumeProvider } from "./exa-key-resume-context";
import { useSettingsOpener } from "./settings-opener-context";
import PageHeader from "./page-header";
import { DeleteProjectDialog, ProjectDialog } from "./project-dialogs";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function relativeDay(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: then.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function paperKey(arxivId: string | null, url: string | null): string {
  return arxivId ? `a:${normalizeArxivId(arxivId)}` : `u:${url ?? ""}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

interface ReadingEntry {
  rec: Recommendation;
  /** The thread (root brief id) the pick came from, for "open session". */
  threadId: string;
  /** The question of the run that suggested it (root or follow-up). */
  question: string;
}

/**
 * One reading list across all of a project's research, ordered by the
 * judge's score (see src/lib/judge-rubric.ts). Picks not yet judged fall
 * back to the sessions' own order: every session's #1 first (newest session
 * first), then every #2, and so on, after the judged ones. A paper suggested
 * by more than one session appears once, at its best position.
 */
function combineReadingList(threads: ThreadView[]): ReadingEntry[] {
  const runs = threads
    .flatMap((t) =>
      [t.root, ...t.followups].map((run) => ({
        threadId: t.root.query.id,
        question: run.query.query,
        createdAt: new Date(run.query.createdAt).getTime(),
        recs: run.recommendations,
      })),
    )
    .sort((a, b) => b.createdAt - a.createdAt);

  const all = runs.flatMap((run, runIdx) =>
    run.recs.map((rec) => ({ rec, runIdx, run })),
  );
  all.sort((a, b) => a.rec.rank - b.rec.rank || a.runIdx - b.runIdx);
  const ordered = orderByJudge(all, (e) => e.rec.judgeScore);

  const seen = new Set<string>();
  const out: ReadingEntry[] = [];
  for (const { rec, run } of ordered) {
    const key = paperKey(rec.arxivId, rec.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ rec, threadId: run.threadId, question: run.question });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Rows                                                               */
/* ------------------------------------------------------------------ */

function ListPanel({ children }: { children: React.ReactNode }) {
  return (
    <ul
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      {children}
    </ul>
  );
}

const ROW_BUTTON =
  "w-full px-6 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30";

function ReviewRow({ review }: { review: PaperReview }) {
  const router = useRouter();
  const Icon = review.sourceUrl ? Globe : FileText;
  let source = "PDF";
  if (review.arxivId) source = "arXiv";
  else if (review.sourceUrl) {
    try {
      source = new URL(review.sourceUrl).host.replace(/^www\./, "");
    } catch {
      source = "Web";
    }
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => router.push(`/review/${review.id}`)}
        className={`flex items-center gap-4 ${ROW_BUTTON}`}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-foreground">
            {review.title}
          </span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">
            {source} · Opened {relativeDay(review.updatedAt).toLowerCase()}
          </span>
        </span>
      </button>
    </li>
  );
}

function SessionRow({
  thread,
  onOpen,
}: {
  thread: ThreadView;
  onOpen: (id: string) => void;
}) {
  const q = thread.root.query;
  const live = !!thread.root.liveSteps;
  const picks = thread.root.recommendations.length;
  const meta = [
    relativeDay(q.createdAt),
    picks > 0 ? plural(picks, "source", "sources") : "No sources",
    thread.followups.length > 0
      ? plural(thread.followups.length, "follow-up", "follow-ups")
      : null,
  ].filter(Boolean);
  return (
    <li>
      <button type="button" onClick={() => onOpen(q.id)} className={ROW_BUTTON}>
        <span className="block text-[15px] font-medium leading-snug text-foreground">
          {q.query}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          {live ? (
            <span className="inline-flex items-center gap-1.5 text-primary">
              <span className="landing-pulse-dot" />
              Researching
            </span>
          ) : q.status === "errored" ? (
            <span className="inline-flex items-center gap-1 text-destructive/85">
              <AlertCircle className="size-3.5" strokeWidth={2} />
              Errored
            </span>
          ) : (
            meta.join(" · ")
          )}
        </span>
      </button>
    </li>
  );
}

const QUIET_BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

/**
 * A project's home. The overview is one reading list across all of the
 * project's research, each entry linked to the session that suggested it.
 * Searching here files the new session into the project and tells the agent
 * what the project already has; while it runs, a single status row stands in
 * for it, and its picks join the list when it's done. `?brief=<id>` opens one
 * session full-page, still inside the project.
 */
export default function ProjectPanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openId = searchParams.get("brief");
  const projects = useProjects();
  const project = projects.find((p) => p.id === projectId) ?? null;
  const { openSettings } = useSettingsOpener();

  const [hydrated, setHydrated] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pendingParentRef = useRef<string | null>(null);
  // A question asked on Home, which created this project for it; started
  // once keys and data are loaded. Its brief opens as soon as the run exists,
  // and until then the page already shows it starting (`startingQuestion`)
  // rather than flashing the empty overview.
  const [initialHandoff] = useState<string | null>(() => takePendingResearch());
  const [handoff, setHandoff] = useState(initialHandoff);
  const [startingQuestion, setStartingQuestion] = useState(initialHandoff);
  const handoffRunRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all([hydrateClientStore(), ensureDiscoverLoaded()]);
        if (!cancelled) setModelReady(hasUsableProvider());
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const chat = useDiscoverChat({ modelReady });
  const canSubmit = modelReady && chat.hasKeyForModel;
  const { threads, hasExaKey } = useDiscoverBriefs(
    chat.liveQueryId,
    chat.liveSteps,
  );

  const setOpenId = useCallback(
    (id: string | null, opts?: { replace?: boolean }) => {
      if (id === openId) return;
      const base = `/projects/${projectId}`;
      const href = id ? `${base}?brief=${encodeURIComponent(id)}` : base;
      if (opts?.replace) router.replace(href);
      else router.push(href);
    },
    [openId, projectId, router],
  );

  // A follow-up is threaded under the session it continues. A new search
  // doesn't navigate anywhere: it shows as the status row on the overview.
  // The question handed off from Home opens its brief, replacing the entry
  // so Back returns to Home.
  useEffect(() => {
    if (!chat.liveQueryId) return;
    if (handoffRunRef.current) {
      handoffRunRef.current = false;
      // The starting view stays up until the URL catches up (below);
      // clearing it here left a beat with neither, which flashed the
      // empty overview.
      setOpenId(chat.liveQueryId, { replace: true });
      return;
    }
    const parent = pendingParentRef.current;
    if (!parent) return;
    linkThread(chat.liveQueryId, parent);
    pendingParentRef.current = null;
    // Only react to a new live run, not to URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.liveQueryId]);

  const search = useCallback(
    (text: string) => {
      if (!canSubmit) {
        openSettings();
        return;
      }
      pendingParentRef.current = null;
      void chat.submit(text, researchOptions(projectId, text, text));
    },
    [canSubmit, chat, openSettings, projectId],
  );

  useEffect(() => {
    if (!hydrated || !handoff) return;
    handoffRunRef.current = canSubmit;
    search(handoff);
    setHandoff(null);
    // No key: search() opened Settings instead, so there's no run to show.
    if (!canSubmit) setStartingQuestion(null);
  }, [hydrated, handoff, search, canSubmit]);

  // The run failed before it existed: drop back to the overview, which
  // shows the error.
  useEffect(() => {
    if (chat.error) setStartingQuestion(null);
  }, [chat.error]);

  const followup = useCallback(
    (parentId: string, text: string) => {
      if (!canSubmit) {
        openSettings();
        return;
      }
      const parent = getDiscoverQueriesSnapshot().find((q) => q.id === parentId);
      if (!parent) return;
      const picks = getRecommendationsSnapshot().filter(
        (r) => r.queryId === parentId && !r.dismissedAt,
      );
      pendingParentRef.current = parentId;
      void chat.submit(
        text,
        researchOptions(
          projectId,
          buildFollowupPrompt(parent, picks, text),
          followupQuestion(parent.query, text),
        ),
      );
    },
    [canSubmit, chat, openSettings, projectId],
  );

  /* ── What the project holds ── */

  const reviews = getReviewsSnapshot();
  const projectThreads = useMemo(
    () =>
      threads
        .filter((t) => t.root.query.projectId === projectId)
        .sort(
          (a, b) =>
            new Date(b.root.query.createdAt).getTime() -
            new Date(a.root.query.createdAt).getTime(),
        ),
    [threads, projectId],
  );
  const readingList = useMemo(
    () => combineReadingList(projectThreads),
    [projectThreads],
  );
  // Papers filed in the project that no session suggested (added by hand).
  const otherReviews = useMemo(() => {
    const picked = new Set(
      readingList.map((e) => paperKey(e.rec.arxivId, e.rec.url)),
    );
    return reviews
      .filter((r) => r.projectId === projectId)
      .filter((r) => !picked.has(paperKey(r.arxivId, r.sourceUrl)))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [reviews, projectId, readingList]);
  const reviewCount = reviews.filter((r) => r.projectId === projectId).length;

  // Judge picks saved before the judge existed, once per visit. Live runs
  // are skipped; they're judged when they finish.
  const [judging, setJudging] = useState(false);
  const backfilledRef = useRef(false);
  useEffect(() => {
    if (!hydrated || backfilledRef.current) return;
    const unscored = projectThreads
      .flatMap((t) => [t.root, ...t.followups])
      .filter(
        (run) =>
          !run.liveSteps &&
          [...run.recommendations, ...run.dismissed].some(
            (r) => r.judgeScore === null,
          ),
      )
      .map((run) => run.query.id);
    backfilledRef.current = true;
    if (unscored.length === 0) return;
    setJudging(true);
    void judgeBriefs(unscored.slice(0, 20))
      .catch(() => false)
      .finally(() => setJudging(false));
  }, [hydrated, projectThreads]);

  // The run going on right now, if this page started it.
  const liveThread = chat.liveQueryId
    ? projectThreads.find(
        (t) =>
          t.root.query.id === chat.liveQueryId ||
          t.followups.some((f) => f.query.id === chat.liveQueryId),
      )
    : undefined;
  const runningQuestion = chat.isStreaming
    ? (chat.liveQueryText ?? liveThread?.root.query.query ?? null)
    : null;

  const openThread = openId
    ? projectThreads.find((t) => t.root.query.id === openId)
    : undefined;
  const openIsLive = !!openThread && openThread === liveThread;

  if (hydrated && !project) {
    return (
      <Canvas>
        <PageHeader title="Project not found" />
        <p className="mt-3 text-[15px] text-muted-foreground">
          It may have been deleted. Its research is still in Artifacts.
        </p>
      </Canvas>
    );
  }

  /* ── The question from Home, starting ── */

  // Its brief is open now: the starting view's job is done. Adjusted during
  // render so there's no frame between the two views.
  if (startingQuestion && openId) setStartingQuestion(null);

  if (startingQuestion && !openId) {
    const steps = chat.liveSteps ?? [];
    return (
      <Canvas>
        <div className="flex h-8 items-center">
          <button
            type="button"
            onClick={() => setStartingQuestion(null)}
            className={`-ml-2 ${QUIET_BUTTON}`}
          >
            <ArrowLeft className="size-3.5" strokeWidth={2} />
            {project?.name ?? "Project"}
          </button>
        </div>
        <div className="mt-8">
          <h1 className="max-w-[30ch] text-[30px] font-semibold leading-[1.2] tracking-[-0.025em] text-foreground">
            {startingQuestion}
          </h1>
          <p className="mt-3 flex items-center gap-2 text-[14px] text-muted-foreground">
            <span className="landing-pulse-dot" aria-hidden />
            {LIVE_RUN_NOTE}
          </p>
          <div className="mt-10">
            <DiscoverLiveProgress steps={steps} />
          </div>
        </div>
      </Canvas>
    );
  }

  /* ── One session, full page ── */

  if (openId) {
    return (
      <ExaKeyResumeProvider resumeAfterExaDecision={chat.resumeAfterExaDecision}>
        <Canvas>
          <div className="flex h-8 items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className={`-ml-2 ${QUIET_BUTTON}`}
            >
              <ArrowLeft className="size-3.5" strokeWidth={2} />
              {project?.name ?? "Project"}
            </button>
            {openIsLive ? (
              <button type="button" onClick={chat.stop} className={`-mr-2 ${QUIET_BUTTON}`}>
                <Square className="size-2.5 fill-current" strokeWidth={0} />
                Stop research
              </button>
            ) : null}
          </div>

          <div className="mt-8">
            {chat.error ? (
              <div className="mb-8">
                <ErrorBanner message={chat.error} />
              </div>
            ) : null}
            {openThread ? (
              <>
                <ResearchBrief
                  run={openThread.root}
                  followups={openThread.followups}
                  hasExaKey={hasExaKey}
                  onRetry={search}
                  showProject={false}
                />
                {chat.pendingExaDecision ? (
                  <div className="mt-12">
                    <ExaKeyPromptCard queryText={chat.pendingExaDecision.text} />
                  </div>
                ) : !openIsLive && canSubmit ? (
                  <div className="mt-16 border-t border-border pt-10">
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                      Ask a follow-up
                    </h2>
                    <p className="mt-1 text-[14px] text-muted-foreground">
                      The answer is added below, and its picks join the
                      project&rsquo;s reading list.
                    </p>
                    <div className="mt-4">
                      <ResearchComposer
                        disabled={false}
                        isStreaming={chat.isStreaming}
                        hint="Go deeper, narrow the scope, or compare…"
                        onSubmit={(text) => followup(openThread.root.query.id, text)}
                      />
                    </div>
                  </div>
                ) : null}
              </>
            ) : hydrated ? (
              <p className="text-[14px] text-muted-foreground">
                This research session isn&rsquo;t in this project. It may have
                been moved or deleted.
              </p>
            ) : null}
          </div>
        </Canvas>
      </ExaKeyResumeProvider>
    );
  }

  /* ── Overview ── */

  const counts = [
    reviewCount > 0 ? plural(reviewCount, "review", "reviews") : null,
    projectThreads.length > 0
      ? plural(projectThreads.length, "research session", "research sessions")
      : null,
  ].filter(Boolean);
  const isEmpty =
    hydrated &&
    readingList.length === 0 &&
    otherReviews.length === 0 &&
    projectThreads.length === 0 &&
    !runningQuestion;

  return (
    <ExaKeyResumeProvider resumeAfterExaDecision={chat.resumeAfterExaDecision}>
      <Canvas>
        <PageHeader
          title={project?.name ?? ""}
          actions={
            project ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Project options"
                  className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <MoreHorizontal className="size-4" strokeWidth={2} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => setRenaming(true)}>
                    <Pencil className="mr-2 size-3.5" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2 className="mr-2 size-3.5" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null
          }
        />
        {counts.length > 0 ? (
          <p className="mt-1.5 text-[14px] text-muted-foreground">
            {counts.join(" · ")}
          </p>
        ) : null}

        {/* ── Search inside the project ── */}
        <div className="mt-8">
          <ResearchComposer
            disabled={hydrated && !canSubmit}
            isStreaming={chat.isStreaming}
            hint={
              !hydrated || canSubmit
                ? "Find more for this project…"
                : "Add a Fireworks API key in Settings to search"
            }
            onSubmit={search}
          />
          <p className="mt-2 pl-1 text-[13px] text-muted-foreground">
            New finds join the reading list below. Sources already in the
            project are skipped.
          </p>
        </div>

        {chat.pendingExaDecision ? (
          <div className="mt-6">
            <ExaKeyPromptCard queryText={chat.pendingExaDecision.text} />
          </div>
        ) : null}
        {chat.error ? (
          <div className="mt-6">
            <ErrorBanner message={chat.error} />
          </div>
        ) : null}

        {/* ── The search in progress: one row, fixed height ── */}
        {runningQuestion ? (
          <div className="mt-6 flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4">
            <span className="landing-pulse-dot shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium text-foreground">
                {runningQuestion}
              </p>
              <p className="mt-0.5 truncate text-[13px] text-primary">
                {liveStatusLine(chat.liveSteps)}
              </p>
            </div>
            {liveThread ? (
              <button
                type="button"
                onClick={() => setOpenId(liveThread.root.query.id)}
                className={QUIET_BUTTON}
              >
                View progress
              </button>
            ) : null}
            <button type="button" onClick={chat.stop} className={QUIET_BUTTON}>
              <Square className="size-2.5 fill-current" strokeWidth={0} />
              Stop
            </button>
          </div>
        ) : null}

        {isEmpty ? (
          <div className="mt-12 rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <p className="text-[15px] font-medium text-foreground">
              Nothing in this project yet
            </p>
            <p className="mx-auto mt-1.5 max-w-[440px] text-[14px] leading-relaxed text-muted-foreground">
              Search above to find papers for it. What the search finds is
              listed here, and papers you start reviewing are filed into the
              project.
            </p>
          </div>
        ) : (
          <div className="mt-14 space-y-12">
            {readingList.length > 0 ? (
              <BriefSection
                title="Reading list"
                count={
                  judging
                    ? `${plural(readingList.length, "source", "sources")} · Ranking…`
                    : plural(readingList.length, "source", "sources")
                }
              >
                <ol className="divide-y divide-border border-y border-border">
                  {readingList.map((entry, i) => (
                    <li key={entry.rec.id}>
                      <RecommendationCard
                        rec={entry.rec}
                        rank={i + 1}
                        origin={{
                          label: entry.question,
                          onOpen: () => setOpenId(entry.threadId),
                        }}
                      />
                    </li>
                  ))}
                </ol>
              </BriefSection>
            ) : null}

            {otherReviews.length > 0 ? (
              <BriefSection
                title="Other reviews"
                count={plural(otherReviews.length, "review", "reviews")}
              >
                <ListPanel>
                  {otherReviews.map((r) => (
                    <ReviewRow key={r.id} review={r} />
                  ))}
                </ListPanel>
              </BriefSection>
            ) : null}

            {projectThreads.length > 0 ? (
              <BriefSection
                title="Research sessions"
                count={String(projectThreads.length)}
              >
                <ListPanel>
                  {projectThreads.map((t) => (
                    <SessionRow key={t.root.query.id} thread={t} onOpen={setOpenId} />
                  ))}
                </ListPanel>
              </BriefSection>
            ) : null}
          </div>
        )}
      </Canvas>

      {project && renaming ? (
        <ProjectDialog
          mode="edit"
          project={project}
          open
          onClose={() => setRenaming(false)}
        />
      ) : null}
      {project && deleting ? (
        <DeleteProjectDialog
          project={project}
          paperCount={reviewCount}
          briefCount={projectThreads.length}
          onClose={() => setDeleting(false)}
          onDeleted={() => router.push("/projects")}
        />
      ) : null}
    </ExaKeyResumeProvider>
  );
}

/** The scrolling page column, matching Home and Artifacts. */
function Canvas({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--reader-mat)" }}>
      <div className="mx-auto w-full max-w-4xl px-6 pb-20 pt-12 sm:px-8 sm:pt-14">
        {children}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
      {message}
    </div>
  );
}
