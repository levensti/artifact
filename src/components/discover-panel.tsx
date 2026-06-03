"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Compass, KeyRound, ArrowUp } from "lucide-react";
import type { Model } from "@/lib/models";
import { hasUsableProvider } from "@/lib/keys";
import {
  getDiscoverQueriesSnapshot,
  getSavedSelectedModel,
  hydrateClientStore,
} from "@/lib/client-data";
import { DISCOVER_UPDATED_EVENT } from "@/lib/storage-events";
import DiscoverQueue from "./discover-queue";
import { ExaKeyResumeProvider } from "./exa-key-resume-context";
import { useDiscoverChat } from "@/hooks/use-discover-chat";
import { useSettingsOpener } from "./settings-opener-context";
import { MonoLabel } from "./folio";
import { cn } from "@/lib/utils";

const EXAMPLE_QUERIES = [
  "Recent papers on speculative decoding",
  "What's new in linear attention since 2024?",
  "Diffusion model alignment, post-DPO",
  "Test-time compute scaling laws",
];

/* ------------------------------------------------------------------ */
/*  Composer                                                           */
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

  // Auto-resize the textarea to fit content, capped at 160px (max-h-40).
  // Below the cap we hide overflow so subpixel rounding doesn't trigger
  // a phantom scrollbar; at the cap we enable scrolling internally.
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
        "flex items-end gap-2 rounded-xl border bg-card px-3 py-2 transition-colors",
        isStreaming
          ? "border-border/40 opacity-80"
          : "border-border/70 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15",
      )}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={hint}
        rows={1}
        disabled={isStreaming}
        className="min-h-[24px] max-h-40 flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:cursor-not-allowed"
        style={{ fontFamily: "var(--font-reading)" }}
      />
      <button
        type="button"
        onClick={send}
        disabled={!canSend}
        aria-label="Search"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
          canSend
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "text-muted-foreground/40 hover:text-muted-foreground/60",
        )}
      >
        <ArrowUp className="size-3.5" strokeWidth={2.25} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty hint                                                         */
/* ------------------------------------------------------------------ */

function EmptyHint({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="mt-4 space-y-4">
      <div>
        <h1 className="text-[24px] font-bold leading-[1.05] tracking-[-0.025em] text-foreground">
          What do you want to read about?
        </h1>
        <p
          className="mt-2 max-w-[520px] text-[13px] leading-[1.6]"
          style={{
            fontFamily: "var(--font-reading)",
            color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
          }}
        >
          Describe a research topic, method, or question. The agent searches
          Semantic Scholar (and the open web when useful), then surfaces a short
          list of papers with a one-line rationale for each. One click to start
          a review.
        </p>
      </div>

      <div className="space-y-2">
        <MonoLabel>Try one of these</MonoLabel>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUERIES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPick(q)}
              className="rounded-full border border-border/70 bg-card px-3 py-1.5 text-[12px] text-foreground/85 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
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
  // Local re-render trigger when the discover cache changes — used to
  // toggle the empty-hint visibility based on whether any queries exist.
  const [, force] = useState(0);
  const { openSettings } = useSettingsOpener();

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

  useEffect(() => {
    const handler = () => force((n) => n + 1);
    window.addEventListener(DISCOVER_UPDATED_EVENT, handler);
    return () => window.removeEventListener(DISCOVER_UPDATED_EVENT, handler);
  }, []);

  const chat = useDiscoverChat({ selectedModel });

  const composerHint =
    selectedModel && chat.hasKeyForModel
      ? "What would you like to learn?"
      : "Add an OpenRouter API key in Settings to start";

  const queries = hydrated ? getDiscoverQueriesSnapshot() : [];
  const showEmptyHint =
    hydrated && !chat.isStreaming && !chat.pendingExaDecision && queries.length === 0;

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
                Find what to read next
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <ExaKeyResumeProvider
          resumeAfterExaDecision={chat.resumeAfterExaDecision}
        >
          <div className="mx-auto w-full max-w-3xl space-y-5">
            {/* Composer at top — primary input */}
            <Composer
              disabled={!selectedModel || !chat.hasKeyForModel}
              isStreaming={chat.isStreaming}
              hint={composerHint}
              onSubmit={(t) => void chat.submit(t)}
            />

            {/* Model-key prompt for un-keyed users */}
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
                      if you haven&rsquo;t yet.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Error from the most recent submission */}
            {chat.error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                {chat.error}
              </div>
            ) : null}

            {/* Persistent queue, grouped by query. The in-flight query
                streams its agent activity inline into its own section.
                A pending Exa-key decision renders as a synthetic live
                section at the top so the prompt feels like the first
                step of an active discovery, not a pre-flight modal. */}
            <DiscoverQueue
              liveQueryId={chat.liveQueryId}
              liveSteps={chat.liveSteps}
              pendingDecision={chat.pendingExaDecision}
            />

            {showEmptyHint ? (
              <EmptyHint onPick={(q) => void chat.submit(q)} />
            ) : null}
          </div>
        </ExaKeyResumeProvider>
      </div>
    </div>
  );
}
