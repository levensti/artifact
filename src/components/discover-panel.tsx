"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUp, KeyRound, Square } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { DISCOVER_HOME_EVENT } from "@/lib/storage-events";

/* ------------------------------------------------------------------ */
/*  Composer — the research kickoff card                               */
/* ------------------------------------------------------------------ */

function Composer({
  disabled,
  isStreaming,
  hint,
  onSubmit,
}: {
  disabled: boolean;
  isStreaming: boolean;
  hint: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSend = !disabled && !isStreaming && text.trim().length > 0;
  const inert = disabled || isStreaming;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const MAX = 160;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX ? "auto" : "hidden";
  }, [text]);

  const send = useCallback(() => {
    if (!canSend) return;
    const trimmed = text.trim();
    setText("");
    onSubmit(trimmed);
  }, [canSend, text, onSubmit]);

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-card transition-colors",
        disabled
          ? "border-border/50 opacity-60"
          : isStreaming
            ? "border-border/50 opacity-90"
            : "border-border focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/15",
      )}
      style={{ boxShadow: disabled ? undefined : "var(--shadow-sm)" }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={hint}
        rows={1}
        disabled={inert}
        className="block max-h-44 min-h-[50px] w-full resize-none bg-transparent py-3 pl-4 pr-12 text-[15px] leading-normal text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
      />
      <button
        type="button"
        onClick={send}
        disabled={!canSend}
        aria-label="Research"
        title="Research"
        className={cn(
          "absolute bottom-2 right-2 inline-flex size-8 items-center justify-center rounded-md transition-colors",
          canSend
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "cursor-default bg-muted text-muted-foreground/60",
        )}
      >
        <ArrowUp className="size-4" strokeWidth={2.25} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Heading + suggestions                                              */
/* ------------------------------------------------------------------ */

function EmptyHeading() {
  return (
    <p className="-mt-1.5 max-w-[600px] text-[15px] leading-[1.6] text-muted-foreground">
      Ask a research question. The agent plans a search, reads across arXiv and
      the web, verifies what it finds, then writes you a short briefing with a
      ranked reading list.
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export default function DiscoverPanel() {
  const [hydrated, setHydrated] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  // The brief in focus (a root query id) lives in the URL (`?brief=<id>`) so
  // it survives refresh, works with Back, and can be linked. null = browse.
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusedId = searchParams.get("brief");
  const setFocusedId = useCallback(
    (id: string | null) => {
      if (id === focusedId) return;
      router.push(
        id ? `/discover?brief=${encodeURIComponent(id)}` : "/discover",
        { scroll: false },
      );
    },
    [focusedId, router],
  );
  // Set while a follow-up is starting: the parent brief the new run belongs
  // under. Consumed once the run's query id exists.
  const pendingParentRef = useRef<string | null>(null);
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
      setFocusedId(chat.liveQueryId);
    }
    // Only react to a new live run, not to URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.liveQueryId]);

  useEffect(() => {
    const handleDiscoverHome = () => setFocusedId(null);
    window.addEventListener(DISCOVER_HOME_EVENT, handleDiscoverHome);
    return () =>
      window.removeEventListener(DISCOVER_HOME_EVENT, handleDiscoverHome);
  }, [setFocusedId]);

  const handleSubmit = useCallback(
    (text: string) => {
      if (!canSubmit) {
        openSettings();
        return;
      }
      pendingParentRef.current = null;
      void chat.submit(text);
    },
    [canSubmit, chat, openSettings],
  );

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

  const composerHint = canSubmit
    ? "What do you want to explore?"
    : "Add a Fireworks API key in Settings to start";

  // Browse vs focus. A brief is in focus when the URL names one, plus the
  // moments before a run has a query id to put there (awaiting the web-search
  // decision, or the run's row still being created). Leaving a running brief
  // is allowed: its history tile shows it as live.
  const inFocus =
    focusedId !== null ||
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

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ background: "var(--reader-mat)" }}
    >
      {/* The header lives in-canvas at the top of the browse column, Claude-
          style (page title + action, then the composer beneath). The column
          spec is kept identical to Journal so navigating between the two pages
          doesn't shift the title or input. */}
      <ExaKeyResumeProvider
        resumeAfterExaDecision={chat.resumeAfterExaDecision}
      >
        <div className="mx-auto w-full max-w-4xl px-6 pb-16 pt-12 sm:px-8 sm:pt-14">
          {inFocus ? (
            /* ── Focus: one research session owns the canvas ── */
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setFocusedId(null)}
                  className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ArrowLeft className="size-3.5" strokeWidth={2} />
                  All research
                </button>
                {focusedIsLive ? (
                  <button
                    type="button"
                    onClick={chat.stop}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <Square className="size-2.5 fill-current" strokeWidth={0} />
                    Stop
                  </button>
                ) : null}
              </div>

              {chat.error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                  {chat.error}
                </div>
              ) : null}

              {focusedThread ? (
                <>
                  <ResearchBrief
                    pinned
                    run={focusedThread.root}
                    followups={focusedThread.followups}
                    defaultCollapsed={false}
                    hasExaKey={hasExaKey}
                    onRetry={handleSubmit}
                  />
                  {chat.pendingExaDecision ? (
                    <ExaKeyPromptCard queryText={chat.pendingExaDecision.text} />
                  ) : !focusedIsLive && canSubmit ? (
                    <div className="border-t border-border pt-5">
                      <Composer
                        disabled={false}
                        isStreaming={chat.isStreaming}
                        hint="Ask a follow-up: go deeper, narrow the scope, compare…"
                        onSubmit={(text) =>
                          handleFollowup(focusedThread.root.query.id, text)
                        }
                      />
                    </div>
                  ) : null}
                </>
              ) : chat.pendingExaDecision ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="landing-pulse-dot mt-2 block shrink-0" />
                    <p className="text-[19px] font-semibold leading-snug text-foreground">
                      {chat.pendingExaDecision.text}
                    </p>
                  </div>
                  <ExaKeyPromptCard queryText={chat.pendingExaDecision.text} />
                </div>
              ) : chat.isStreaming || !hydrated ? (
                <p className="text-[13px] text-muted-foreground">
                  {chat.isStreaming ? "Starting research…" : "Loading…"}
                </p>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  This brief isn&rsquo;t available. It may have been deleted.
                </p>
              )}
            </div>
          ) : (
            /* ── Browse: kickoff + recent research ── */
            <div className="space-y-5">
              <PageHeader title="Discover" />

              {!hasHistory ? <EmptyHeading /> : null}

              <Composer
                disabled={!canSubmit}
                isStreaming={chat.isStreaming}
                hint={composerHint}
                onSubmit={handleSubmit}
              />

              {chat.error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                  {chat.error}
                </div>
              ) : null}

              {hydrated && !modelReady ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <KeyRound
                      className="mt-0.5 size-4 shrink-0 text-primary/80"
                      strokeWidth={1.75}
                    />
                    <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
                      <p className="font-medium text-foreground">
                        Add an API key to start
                      </p>
                      <p className="text-muted-foreground">
                        Discover uses the same Fireworks key as the rest of
                        Artifact. Add one in{" "}
                        <button
                          type="button"
                          onClick={() => openSettings()}
                          className="underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                        >
                          settings
                        </button>{" "}
                        to begin researching.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Recent research — quiet, browsable history */}
              {hasHistory ? (
                <div className="pt-1">
                  <RecentBriefsList threads={threads} onOpen={setFocusedId} />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </ExaKeyResumeProvider>
    </div>
  );
}
