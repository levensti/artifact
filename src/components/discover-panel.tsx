"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  ArrowUp,
  Compass,
  KeyRound,
  Library,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import type { Model } from "@/lib/models";
import { hasUsableProvider } from "@/lib/keys";
import {
  getDiscoverQueriesSnapshot,
  getRecommendationsSnapshot,
  getReviewsSnapshot,
  getSavedSelectedModel,
  getWikiCacheSnapshot,
  hydrateClientStore,
} from "@/lib/client-data";
import { buildFollowupPrompt, linkThread } from "@/lib/discover-threads";
import { useDiscoverBriefs, RecentBriefsList } from "./discover-queue";
import ResearchBrief from "./research-brief";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import { ExaKeyResumeProvider } from "./exa-key-resume-context";
import { useDiscoverChat } from "@/hooks/use-discover-chat";
import { useSettingsOpener } from "./settings-opener-context";
import { MonoLabel } from "./folio";
import { cn } from "@/lib/utils";

const EXAMPLE_QUERIES = [
  "How has linear attention evolved since 2024, and what should I read first?",
  "What's the current state of speculative decoding?",
  "Diffusion-model alignment beyond DPO — what's worth reading?",
  "Test-time compute scaling laws",
];

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
        "overflow-hidden rounded-2xl border bg-card transition-colors",
        disabled
          ? "border-border/50 opacity-60"
          : isStreaming
            ? "border-border/50 opacity-90"
            : "border-input focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10",
      )}
      style={{
        boxShadow: disabled
          ? undefined
          : "0 1px 0 rgb(0 0 0 / 0.03), 0 12px 28px -18px rgb(0 0 0 / 0.25)",
      }}
    >
      <div className="px-4 pt-3.5">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={hint}
          rows={1}
          disabled={inert}
          className="block max-h-40 min-h-[26px] w-full resize-none bg-transparent text-[16px] leading-relaxed text-foreground placeholder:text-muted-foreground/55 focus:outline-none disabled:cursor-not-allowed"
          style={{ fontFamily: "var(--font-reading)" }}
        />
      </div>

      <div
        className="mt-2.5 flex items-center gap-2 px-3.5 pb-3 pt-2.5"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <span className="flex-1" />
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label="Research"
          className={cn(
            "inline-flex h-[34px] items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition-colors",
            canSend
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "cursor-default text-muted-foreground/45",
          )}
          style={canSend ? undefined : { background: "var(--muted)" }}
        >
          Research
          <ArrowUp className="size-3.5" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Library grounding line                                             */
/* ------------------------------------------------------------------ */

function LibraryLine() {
  const papers = getReviewsSnapshot().length;
  const wiki = getWikiCacheSnapshot();
  const entries = wiki?.length ?? null;
  if (papers === 0 && (entries === null || entries === 0)) return null;
  return (
    <div
      className="flex items-center gap-1.5 text-[11.5px]"
      style={{ color: "color-mix(in srgb, var(--muted-foreground) 85%, transparent)" }}
    >
      <Library className="size-3.5 shrink-0 text-primary/70" strokeWidth={1.75} />
      <span>
        Ranked against your library —{" "}
        <b className="font-semibold text-foreground/80">
          {papers} paper{papers === 1 ? "" : "s"}
        </b>
        {entries !== null ? (
          <>
            ,{" "}
            <b className="font-semibold text-foreground/80">
              {entries} journal {entries === 1 ? "entry" : "entries"}
            </b>
          </>
        ) : null}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Heading + suggestions                                              */
/* ------------------------------------------------------------------ */

function EmptyHeading() {
  return (
    <div>
      <h1 className="text-[27px] font-bold leading-[1.1] tracking-[-0.028em] text-foreground">
        What do you want to understand?
      </h1>
      <p
        className="mt-2.5 max-w-[580px] text-[14.5px] leading-[1.6]"
        style={{
          fontFamily: "var(--font-reading)",
          color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
        }}
      >
        Ask a research question. The agent plans a search, reads across arXiv
        and the web, verifies what it finds, then writes you a short briefing
        with a ranked reading list — grounded in what you&rsquo;ve already read.
      </p>
    </div>
  );
}

function Suggestions({
  label,
  onPick,
}: {
  label: string;
  onPick: (q: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      <MonoLabel>{label}</MonoLabel>
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_QUERIES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="inline-flex items-center gap-1.5 rounded-full border border-input bg-card px-3 py-1.5 text-[13px] text-foreground/85 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
            style={{ fontFamily: "var(--font-reading)" }}
          >
            <Sparkles className="size-3 text-primary/70" strokeWidth={1.75} />
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export default function DiscoverPanel() {
  const [hydrated, setHydrated] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  // The brief currently in focus (a root query id). null = browse view.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const { openSettings } = useSettingsOpener();
  // Parent brief awaiting linkage to the follow-up query it spawned.
  const pendingParentRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await hydrateClientStore();
        if (cancelled) return;
        if (hasUsableProvider()) setSelectedModel(getSavedSelectedModel());
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const chat = useDiscoverChat({ selectedModel });
  const canSubmit = !!selectedModel && chat.hasKeyForModel;
  const { threads, hasExaKey } = useDiscoverBriefs(
    chat.liveQueryId,
    chat.liveSteps,
  );

  // When a run goes live, focus it. A follow-up keeps focus on its parent
  // brief (and links the new query under it); a fresh question focuses itself.
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
  }, [chat.liveQueryId]);

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
    ? "Ask a research question…"
    : "Add an OpenRouter API key in Settings to start";

  // Browse vs focus. We're "in focus" while a run is active (streaming or
  // awaiting the web-search decision) or when a brief has been opened.
  const inFocus =
    focusedId !== null || chat.isStreaming || !!chat.pendingExaDecision;
  const focusedThread =
    threads.find((t) => t.root.query.id === focusedId) ??
    (chat.liveQueryId
      ? threads.find(
          (t) =>
            t.root.query.id === chat.liveQueryId ||
            t.followups.some((f) => f.query.id === chat.liveQueryId),
        )
      : undefined);
  const hasHistory = threads.length > 0;

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ background: "var(--reader-mat)" }}
    >
      {/* Header */}
      <header className="shrink-0 border-b border-border/50 bg-background/60 px-5 py-3 backdrop-blur-sm sm:px-8">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Compass className="size-4 text-primary/80" strokeWidth={2} />
            <div className="flex flex-col leading-tight">
              <MonoLabel>Discover</MonoLabel>
              <span
                className="text-[11px]"
                style={{
                  fontFamily: "var(--font-reading)",
                  color:
                    "color-mix(in srgb, var(--foreground) 60%, transparent)",
                }}
              >
                Research what to read next
              </span>
            </div>
          </div>

          {selectedModel ? (
            <button
              type="button"
              onClick={() => openSettings()}
              title="Model — change in Settings"
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="size-1.5 rounded-full bg-success" />
              {selectedModel.label}
              <Settings className="size-3 text-muted-foreground/50" />
            </button>
          ) : null}
        </div>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-7 sm:px-8">
        <ExaKeyResumeProvider
          resumeAfterExaDecision={chat.resumeAfterExaDecision}
        >
          <div className="mx-auto w-full max-w-3xl">
            {inFocus ? (
              /* ── Focus: one research session owns the canvas ── */
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setFocusedId(null)}
                    className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ArrowLeft className="size-3.5" strokeWidth={2} />
                    All research
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocusedId(null)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:border-primary/25 hover:bg-muted"
                  >
                    <Plus className="size-3.5" strokeWidth={2} />
                    New research
                  </button>
                </div>

                {chat.error ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                    {chat.error}
                  </div>
                ) : null}

                {focusedThread ? (
                  <ResearchBrief
                    pinned
                    run={focusedThread.root}
                    followups={focusedThread.followups}
                    defaultCollapsed={false}
                    hasExaKey={hasExaKey}
                    canFollowup={canSubmit}
                    followupBusy={chat.isStreaming}
                    onFollowup={handleFollowup}
                    onRetry={handleSubmit}
                  />
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
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    Starting research…
                  </p>
                )}
              </div>
            ) : (
              /* ── Browse: kickoff + recent research ── */
              <div className="space-y-5">
                {!hasHistory ? <EmptyHeading /> : null}

                <Composer
                  disabled={!canSubmit}
                  isStreaming={chat.isStreaming}
                  hint={composerHint}
                  onSubmit={handleSubmit}
                />

                {hydrated ? <LibraryLine /> : null}

                {hydrated ? (
                  <Suggestions
                    label={hasHistory ? "Start new research" : "Try one of these"}
                    onPick={handleSubmit}
                  />
                ) : null}

                {hydrated && !selectedModel ? (
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
                          Discover uses the same OpenRouter key as the rest of
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
    </div>
  );
}
