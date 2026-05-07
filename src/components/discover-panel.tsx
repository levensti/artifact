"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Compass, KeyRound, Trash2, ArrowUp } from "lucide-react";
import type { Model } from "@/lib/models";
import { isModelReady } from "@/lib/keys";
import {
  getSavedSelectedModel,
  hydrateClientStore,
  saveSelectedModel,
} from "@/lib/client-data";
import ModelSelector from "./model-selector";
import DiscoverSteps from "./discover-picks";
import { useDiscoverChat, type DiscoverMessage } from "@/hooks/use-discover-chat";
import type { AgentStep } from "@/hooks/use-chat";
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
/*  Message bubbles                                                    */
/* ------------------------------------------------------------------ */

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md border border-border/60 bg-card px-3.5 py-2 text-[13px] leading-relaxed text-foreground"
        style={{ fontFamily: "var(--font-reading)" }}
      >
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({ steps }: { steps: AgentStep[] }) {
  return (
    <div
      className="max-w-full text-[13px] leading-relaxed text-foreground"
      style={{ fontFamily: "var(--font-reading)" }}
    >
      <DiscoverSteps steps={steps} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

export default function DiscoverPanel() {
  // Mirrors the model-selection wiring used by ChatPanel: hydrate client
  // store, then read+persist the saved model. Discover shares this storage
  // with the rest of the app so flipping model anywhere stays in sync.
  const [hydrated, setHydrated] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const { openSettings } = useSettingsOpener();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await hydrateClientStore();
        if (cancelled) return;
        const m = getSavedSelectedModel();
        if (m && isModelReady(m)) setSelectedModel(m);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleModelChange = useCallback((model: Model | null) => {
    setSelectedModel(model);
    void saveSelectedModel(model);
  }, []);

  const chat = useDiscoverChat({ selectedModel });

  // Auto-scroll the transcript to the bottom while streaming.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chat.messages.length, chat.liveSteps.length, chat.isStreaming]);

  const onComposerKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void chat.sendMessage();
      }
    },
    [chat],
  );

  const isEmpty = chat.messages.length === 0 && !chat.isStreaming;
  const canSend =
    !!selectedModel && chat.hasKeyForModel && !chat.isStreaming && !!chat.input.trim();

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
                Find papers worth reading
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector
              selected={selectedModel}
              onSelect={handleModelChange}
            />
            {chat.messages.length > 0 ? (
              <button
                type="button"
                onClick={chat.clearThread}
                title="Clear discovery thread"
                aria-label="Clear discovery thread"
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8"
      >
        <div className="mx-auto w-full max-w-3xl space-y-5">
          {isEmpty ? (
            <div className="mt-6 space-y-6">
              <div>
                <h1 className="text-[28px] font-bold leading-[1.05] tracking-[-0.025em] text-foreground">
                  What do you want to read about?
                </h1>
                <p
                  className="mt-3 max-w-[520px] text-[14px] leading-[1.6]"
                  style={{
                    fontFamily: "var(--font-reading)",
                    color:
                      "color-mix(in srgb, var(--foreground) 70%, transparent)",
                  }}
                >
                  Describe a research topic, method, or question. The agent
                  will search arXiv (and the open web when useful), surface
                  candidate papers, and let you add any of them straight to
                  your library.
                </p>
              </div>

              <div className="space-y-2">
                <MonoLabel>Try one of these</MonoLabel>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_QUERIES.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={!selectedModel || !chat.hasKeyForModel}
                      onClick={() => void chat.submit(q)}
                      className={cn(
                        "rounded-full border border-border/70 bg-card px-3 py-1.5 text-[12px] text-foreground/85 transition-colors",
                        !selectedModel || !chat.hasKeyForModel
                          ? "cursor-not-allowed opacity-50"
                          : "hover:border-primary/30 hover:bg-primary/5 hover:text-foreground",
                      )}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {hydrated && !selectedModel ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <KeyRound
                      className="mt-0.5 size-4 shrink-0 text-primary/80"
                      strokeWidth={1.75}
                    />
                    <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
                      <p className="font-medium text-foreground">
                        Pick a model to start
                      </p>
                      <p className="text-muted-foreground">
                        Discover uses the same API keys as the rest of
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
            </div>
          ) : (
            <>
              {chat.messages.map((m: DiscoverMessage) =>
                m.role === "user" ? (
                  <UserBubble key={m.id} content={m.content ?? ""} />
                ) : (
                  <AssistantBubble
                    key={m.id}
                    steps={
                      m.id === chat.streamingMsgId
                        ? chat.liveSteps
                        : (m.steps ?? [])
                    }
                  />
                ),
              )}
            </>
          )}

          {chat.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {chat.error}
            </div>
          ) : null}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border/50 bg-background/60 px-5 py-3 backdrop-blur-sm sm:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <div
            className={cn(
              "flex items-end gap-2 rounded-xl border bg-card px-3 py-2 transition-colors",
              chat.isStreaming
                ? "border-border/40 opacity-80"
                : "border-border/70 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15",
            )}
          >
            <textarea
              value={chat.input}
              onChange={(e) => chat.setInput(e.target.value)}
              onKeyDown={onComposerKey}
              placeholder={
                selectedModel && chat.hasKeyForModel
                  ? "What kind of papers are you looking for?"
                  : "Pick a model with a configured API key to start"
              }
              rows={1}
              disabled={chat.isStreaming}
              className="min-h-[24px] max-h-40 flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:cursor-not-allowed"
              style={{ fontFamily: "var(--font-reading)" }}
            />
            <button
              type="button"
              onClick={() => void chat.sendMessage()}
              disabled={!canSend}
              aria-label="Send"
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                canSend
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground/50",
              )}
            >
              <ArrowUp className="size-4" strokeWidth={2.25} />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10.5px] text-muted-foreground/70">
            Discovery threads stay in this tab only — they aren&rsquo;t saved
            across sessions.
          </p>
        </div>
      </div>
    </div>
  );
}
