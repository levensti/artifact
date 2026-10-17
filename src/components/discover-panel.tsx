"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Square } from "lucide-react";
import { hasUsableProvider } from "@/lib/keys";
import {
  ensureDiscoverLoaded,
  getDiscoverQueriesSnapshot,
  getRecommendationsSnapshot,
  hydrateClientStore,
} from "@/lib/client-data";
import { buildFollowupPrompt, linkThread } from "@/lib/discover-threads";
import { useDiscoverBriefs, RecentBriefsList } from "./discover-queue";
import ResearchBrief from "./research-brief";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import { ExaKeyResumeProvider } from "./exa-key-resume-context";
import { useDiscoverChat } from "@/hooks/use-discover-chat";
import { useSettingsOpener } from "./settings-opener-context";
import PageHeader from "./page-header";
import ResearchComposer from "./research-composer";
import { ARTIFACTS_HOME_EVENT } from "@/lib/storage-events";
import { takePendingResearch } from "@/lib/pending-research";

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyArtifacts() {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <p className="text-[15px] font-medium text-foreground">
        Nothing here yet
      </p>
      <p className="mx-auto mt-1.5 max-w-[420px] text-[14px] leading-relaxed text-muted-foreground">
        Ask a question on{" "}
        <Link
          href="/"
          className="underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
        >
          Home
        </Link>
        . The research brief and reading list it produces are saved here.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

/**
 * The Artifacts page: everything Artifact has made for you. Today that's
 * research briefs (started from Home); browse lists them, and `?brief=<id>`
 * focuses one.
 */
export default function DiscoverPanel() {
  const [hydrated, setHydrated] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  // The brief in focus (a root query id) lives in the URL (`?brief=<id>`) so
  // it survives refresh, works with Back, and can be linked. null = browse.
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusedId = searchParams.get("brief");
  const setFocusedId = useCallback(
    (id: string | null, opts?: { replace?: boolean }) => {
      if (id === focusedId) return;
      const href = id
        ? `/artifacts?brief=${encodeURIComponent(id)}`
        : "/artifacts";
      if (opts?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [focusedId, router],
  );
  // Set while a follow-up is starting: the parent brief the new run belongs
  // under. Consumed once the run's query id exists.
  const pendingParentRef = useRef<string | null>(null);
  // A question asked on Home, waiting for hydration before it can start.
  const [handoff, setHandoff] = useState<string | null>(() =>
    takePendingResearch(),
  );
  // True from submitting a new question until its brief is in the URL. The
  // run gets its id a beat before the router catches up; without this the
  // list flashes in between.
  const [awaitingFocus, setAwaitingFocus] = useState(false);
  const { openSettings } = useSettingsOpener();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Keys/reviews come from the shared bootstrap; discover data is
        // lazy-loaded here so it's never in the app-wide bootstrap.
        await Promise.all([hydrateClientStore(), ensureDiscoverLoaded()]);
        if (cancelled) return;
        setModelReady(hasUsableProvider());
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

  // When a run goes live, focus it. A follow-up is threaded under its parent
  // brief, which stays the focused one.
  useEffect(() => {
    if (!chat.liveQueryId) return;
    const parent = pendingParentRef.current;
    if (parent) {
      linkThread(chat.liveQueryId, parent);
      pendingParentRef.current = null;
      setFocusedId(parent);
    } else {
      // From the list (a question handed off from Home), replace the entry
      // so Back returns to where the question was asked.
      setFocusedId(chat.liveQueryId, { replace: focusedId === null });
    }
    // Only react to a new live run, not to URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.liveQueryId]);

  useEffect(() => {
    const handleArtifactsHome = () => setFocusedId(null);
    window.addEventListener(ARTIFACTS_HOME_EVENT, handleArtifactsHome);
    return () =>
      window.removeEventListener(ARTIFACTS_HOME_EVENT, handleArtifactsHome);
  }, [setFocusedId]);

  const handleSubmit = useCallback(
    (text: string) => {
      if (!canSubmit) {
        openSettings();
        return;
      }
      pendingParentRef.current = null;
      setAwaitingFocus(true);
      void chat.submit(text);
    },
    [canSubmit, chat, openSettings],
  );

  // Start the question handed off from Home once keys and data are loaded.
  // submit()'s state updates land in the same batch as clearing the handoff,
  // so the view goes straight from "Loading…" to the live run.
  useEffect(() => {
    if (!hydrated || !handoff) return;
    handleSubmit(handoff);
    setHandoff(null);
  }, [hydrated, handoff, handleSubmit]);

  // Stop holding the focus view once the brief is in the URL, or once it's
  // clear no run is coming (submit bailed or failed before creating one).
  useEffect(() => {
    if (!awaitingFocus) return;
    if (
      focusedId !== null ||
      (!chat.isStreaming && !chat.pendingExaDecision && !handoff)
    ) {
      setAwaitingFocus(false);
    }
  }, [awaitingFocus, focusedId, chat.isStreaming, chat.pendingExaDecision, handoff]);

  const handleFollowup = useCallback(
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
      void chat.submit(text, {
        promptText: buildFollowupPrompt(parent, picks, text),
      });
    },
    [canSubmit, chat, openSettings],
  );

  // Browse vs focus. A brief is in focus when the URL names one, plus the
  // moments before a run has a query id to put there (awaiting the web-search
  // decision, or the run's row still being created). Leaving a running brief
  // is allowed: its history tile shows it as live.
  const inFocus =
    focusedId !== null ||
    handoff !== null ||
    awaitingFocus ||
    !!chat.pendingExaDecision ||
    (chat.isStreaming && !chat.liveQueryId);
  const focusedThread = focusedId
    ? threads.find((t) => t.root.query.id === focusedId)
    : chat.liveQueryId
      ? threads.find(
          (t) =>
            t.root.query.id === chat.liveQueryId ||
            t.followups.some((f) => f.query.id === chat.liveQueryId),
        )
      : undefined;
  // Whether the run streaming right now belongs to the brief on screen.
  const focusedIsLive =
    !!focusedThread &&
    chat.isStreaming &&
    (focusedThread.root.query.id === chat.liveQueryId ||
      focusedThread.followups.some((f) => f.query.id === chat.liveQueryId));
  const hasHistory = threads.length > 0;
  // The question being started, before its brief exists.
  const pendingQuestion =
    chat.pendingExaDecision?.text ??
    chat.liveQueryText ??
    handoff ??
    null;

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ background: "var(--reader-mat)" }}
    >
      {/* The column spec matches Home and Journal so navigating between
          pages doesn't shift the title. */}
      <ExaKeyResumeProvider
        resumeAfterExaDecision={chat.resumeAfterExaDecision}
      >
        <div className="mx-auto w-full max-w-4xl px-6 pb-16 pt-12 sm:px-8 sm:pt-14">
          {inFocus ? (
            /* ── Focus: one research session owns the canvas ── */
            <div>
              <div className="flex h-8 items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setFocusedId(null)}
                  className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <ArrowLeft className="size-3.5" strokeWidth={2} />
                  All artifacts
                </button>
                {focusedIsLive || (!focusedThread && chat.isStreaming) ? (
                  <button
                    type="button"
                    onClick={chat.stop}
                    className="-mr-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <Square className="size-2.5 fill-current" strokeWidth={0} />
                    Stop research
                  </button>
                ) : null}
              </div>

              <div className="mt-8">
                {chat.error ? (
                  <div className="mb-8 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                    {chat.error}
                  </div>
                ) : null}

                {focusedThread ? (
                  <>
                    <ResearchBrief
                      run={focusedThread.root}
                      followups={focusedThread.followups}
                      hasExaKey={hasExaKey}
                      onRetry={handleSubmit}
                    />
                    {chat.pendingExaDecision ? (
                      <div className="mt-12">
                        <ExaKeyPromptCard
                          queryText={chat.pendingExaDecision.text}
                        />
                      </div>
                    ) : !focusedIsLive && canSubmit ? (
                      <div className="mt-16 border-t border-border pt-10">
                        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                          Ask a follow-up
                        </h2>
                        <p className="mt-1 text-[14px] text-muted-foreground">
                          Go deeper, narrow the scope, or compare. The answer is
                          added below this brief.
                        </p>
                        <div className="mt-4">
                          <ResearchComposer
                            disabled={false}
                            isStreaming={chat.isStreaming}
                            hint="e.g. Which of these matter most for inference speed?"
                            onSubmit={(text) =>
                              handleFollowup(focusedThread.root.query.id, text)
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : pendingQuestion ? (
                  /* The brief's row doesn't exist yet: render its title and
                     status in place so the page doesn't change shape when
                     it arrives. */
                  <div>
                    <h1 className="max-w-[30ch] text-[30px] font-semibold leading-[1.2] tracking-[-0.025em] text-foreground">
                      {pendingQuestion}
                    </h1>
                    {chat.pendingExaDecision ? (
                      <div className="mt-10">
                        <ExaKeyPromptCard
                          queryText={chat.pendingExaDecision.text}
                        />
                      </div>
                    ) : (
                      <p className="mt-3 flex items-center gap-2 text-[14px] text-primary">
                        <span className="landing-pulse-dot" aria-hidden />
                        Planning the search
                      </p>
                    )}
                  </div>
                ) : !hydrated ? null : (
                  <p className="text-[14px] text-muted-foreground">
                    This brief isn&rsquo;t available. It may have been deleted.
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* ── Browse: saved artifacts ── */
            <div className="space-y-8">
              <PageHeader title="Artifacts" />

              {chat.error ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                  {chat.error}
                </div>
              ) : null}

              {!hydrated ? null : hasHistory ? (
                <section>
                  <h2 className="flex items-baseline gap-2 text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                    Research briefs
                    <span className="text-[13px] font-normal tabular-nums text-muted-foreground">
                      {threads.length}
                    </span>
                  </h2>
                  <div className="mt-4">
                    <RecentBriefsList threads={threads} onOpen={setFocusedId} />
                  </div>
                </section>
              ) : (
                <EmptyArtifacts />
              )}
            </div>
          )}
        </div>
      </ExaKeyResumeProvider>
    </div>
  );
}
