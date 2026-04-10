"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  MessageSquareQuote,
  Send,
  AlertTriangle,
} from "lucide-react";
import {
  PROVIDER_META,
  isInferenceProviderType,
  type Model,
} from "@/lib/models";
import { getInferenceProfile } from "@/lib/keys";
import type { Annotation } from "@/lib/annotations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import ModelSelector from "./model-selector";
import { useSettingsOpener } from "./settings-opener-context";
import ChatEmptyState from "./chat-empty-state";
import { ChatMessageBubble, type BlockCtx } from "./chat-message-bubble";
import { useChat } from "@/hooks/use-chat";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ChatPanelProps {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  annotations: Annotation[];
  chatThreadAnnotationId: string | null;
  onChatThreadChange: (id: string | null) => void;
  onAnnotationsPersist: () => void;
  hideHeader?: boolean;
  externalPrompt?: string | null;
  onExternalPromptConsumed?: () => void;
  selectedModel?: Model | null;
  onModelChange?: (model: Model | null) => void;
  sourceUrl?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Chat input                                                         */
/* ------------------------------------------------------------------ */

function ChatInput({
  input,
  setInput,
  sendMessage,
  isStreaming,
  selectedModel,
  hasSavedKeys,
  chatThreadAnnotationId,
  onOpenSettings,
}: {
  input: string;
  setInput: (v: string) => void;
  sendMessage: () => Promise<void>;
  isStreaming: boolean;
  selectedModel: Model | null;
  hasSavedKeys: boolean;
  chatThreadAnnotationId: string | null;
  onOpenSettings: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollComposerIntoViewRef = useRef(false);
  const inputLocked = !hasSavedKeys;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;

    if (!scrollComposerIntoViewRef.current) return;
    scrollComposerIntoViewRef.current = false;
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="p-3 border-t border-border shrink-0 bg-muted/20">
      <div
        className={cn(
          "flex items-end gap-2 rounded-md border transition-[box-shadow,border-color,background-color] duration-200",
          inputLocked
            ? "border-amber-500/35 bg-amber-500/5"
            : "bg-card border-border focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-ring/40",
        )}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={inputLocked}
          placeholder={
            inputLocked
              ? "Add an API key to start chatting…"
              : chatThreadAnnotationId
                ? "Reply in this selection thread…"
                : "Ask about the paper…"
          }
          rows={1}
          className={cn(
            "flex-1 bg-transparent px-3 py-2.5 text-sm resize-none text-foreground placeholder:text-muted-foreground",
            inputLocked
              ? "cursor-not-allowed opacity-75"
              : "focus:outline-none",
          )}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 m-1 text-muted-foreground hover:text-primary"
          onClick={sendMessage}
          disabled={
            inputLocked || !selectedModel || !input.trim() || isStreaming
          }
          aria-label={
            !selectedModel
              ? hasSavedKeys
                ? "Choose a model to send"
                : "Manage API keys to send"
              : isStreaming
                ? "Sending..."
                : "Send message"
          }
        >
          {isStreaming ? (
            <Loader2 className="animate-spin" size={15} />
          ) : (
            <Send size={15} />
          )}
        </Button>
      </div>
      <div className="mt-2 space-y-1.5">
        {inputLocked ? (
          <p className="px-1 text-center text-[11px] leading-snug text-amber-700/90">
            Chat is locked until you add an API key.
          </p>
        ) : (
          <p className="px-1 text-center text-[11px] leading-snug text-muted-foreground/85">
            {chatThreadAnnotationId
              ? "Replies stay tied to this highlight."
              : "Messages apply to the whole paper."}
          </p>
        )}
        <p className="px-1 text-center text-xs leading-snug text-muted-foreground/70">
          {selectedModel
            ? `${selectedModel.label} · Shift+Enter new line`
            : hasSavedKeys
              ? "Choose a model above · Shift+Enter new line"
              : "Manage API keys first · Shift+Enter new line"}
        </p>
        {!hasSavedKeys && (
          <div className="flex justify-center">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={onOpenSettings}
            >
              Add API key to unlock chat
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function ChatPanel({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  annotations,
  chatThreadAnnotationId,
  onChatThreadChange,
  onAnnotationsPersist,
  hideHeader,
  externalPrompt,
  onExternalPromptConsumed,
  selectedModel: externalModel,
  onModelChange,
  sourceUrl,
}: ChatPanelProps) {
  const { openSettings } = useSettingsOpener();
  const [internalModel, setInternalModel] = useState<Model | null>(null);

  const selectedModel =
    externalModel !== undefined ? externalModel : internalModel;
  const setSelectedModel = onModelChange ?? setInternalModel;

  const chat = useChat({
    reviewId,
    arxivId,
    paperTitle,
    paperContext,
    selectedModel,
    chatThreadAnnotationId,
    onAnnotationsPersist,
    sourceUrl,
  });

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollComposerIntoViewRef = useRef(false);

  const activeThreadAnn = useMemo(() => {
    if (!chatThreadAnnotationId) return undefined;
    return annotations.find(
      (a) => a.id === chatThreadAnnotationId && a.kind === "ask_ai",
    );
  }, [annotations, chatThreadAnnotationId]);

  const displayThread = useMemo(
    () =>
      chat.displayThread.length > 0
        ? chat.displayThread
        : (activeThreadAnn?.thread ?? []),
    [chat.displayThread, activeThreadAnn?.thread],
  );

  // Auto-scroll on new content
  useLayoutEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const thresholdPx = 120;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist <= thresholdPx) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chat.messages, chat.agentSteps, displayThread]);

  // Reset thread when annotation is gone
  useEffect(() => {
    if (chatThreadAnnotationId && !activeThreadAnn) {
      onChatThreadChange(null);
    }
  }, [chatThreadAnnotationId, activeThreadAnn, onChatThreadChange]);

  // Scroll to top on new thread
  useEffect(() => {
    if (!chatThreadAnnotationId) return;
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [chatThreadAnnotationId]);

  // Handle external prompt
  useEffect(() => {
    if (!externalPrompt) return;
    scrollComposerIntoViewRef.current = true;
    chat.setInput(externalPrompt);
    onExternalPromptConsumed?.();
    const safety = window.setTimeout(() => {
      scrollComposerIntoViewRef.current = false;
    }, 600);
    return () => clearTimeout(safety);
  }, [externalPrompt, onExternalPromptConsumed, chat.setInput, chat]);

  // Scroll composer into view when input changes externally
  useEffect(() => {
    if (!scrollComposerIntoViewRef.current) return;
    scrollComposerIntoViewRef.current = false;

    const scrollMessagesToBottom = () => {
      const el = scrollAreaRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    scrollMessagesToBottom();
    requestAnimationFrame(() => {
      scrollMessagesToBottom();
      requestAnimationFrame(scrollMessagesToBottom);
    });
    setTimeout(scrollMessagesToBottom, 0);
  }, [chat.input]);

  const openKeysForChat = () => {
    if (selectedModel) openSettings({ provider: selectedModel.provider });
    else openSettings();
  };

  const errorText = chat.error ?? "";
  const errorIsAuth =
    /\b(api key|unauthorized|forbidden|401|403|invalid key|missing key)\b/i.test(
      errorText,
    );
  const errorIsTransient =
    /\b(timeout|timed out|429|rate limit|overloaded|unavailable|network|failed to fetch)\b/i.test(
      errorText,
    );

  const blockCtx: BlockCtx = {
    reviewId,
    arxivId,
    paperTitle,
    paperContext,
    selectedModel,
  };

  /* ---------------------------------------------------------------- */
  /*  JSX                                                              */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {!hideHeader && (
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Assistant
          </span>
          <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
        </div>
      )}

      <div
        ref={scrollAreaRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        <div className="space-y-5 px-4 pb-5 pt-5">
          {chatThreadAnnotationId && activeThreadAnn ? (
            <>
              <div className="flex flex-col gap-2 border-b border-border/80 pb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Selection thread
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-9 w-full shrink-0 gap-2 px-3 text-xs font-medium shadow-sm sm:h-8 sm:w-auto"
                  onClick={() => onChatThreadChange(null)}
                  aria-label="Back to whole-paper assistant chat"
                >
                  <ArrowLeft className="size-3.5 shrink-0" strokeWidth={2.5} />
                  Return to main thread
                </Button>
              </div>

              <div className="rounded-lg border border-sky-500/25 bg-sky-500/6 px-3 py-2.5">
                <div className="flex gap-2">
                  <MessageSquareQuote
                    className="mt-0.5 size-4 shrink-0 text-sky-600/90"
                    strokeWidth={2}
                  />
                  <p className="text-xs italic leading-snug text-muted-foreground">
                    &ldquo;{activeThreadAnn.highlightText}&rdquo;
                  </p>
                </div>
              </div>

              {displayThread.length === 0 && (
                <div className="space-y-2 py-6 text-center px-1">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Ask a question about this passage below.
                  </p>
                </div>
              )}

              {displayThread.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  msg={msg}
                  isCurrentlyStreaming={
                    msg.id === chat.streamingMsgId && chat.isStreaming
                  }
                  agentSteps={chat.agentSteps}
                  blockCtx={blockCtx}
                />
              ))}
            </>
          ) : (
            <>
              {chat.messages.length === 0 && (
                <ChatEmptyState
                  canSend={
                    !!selectedModel && chat.hasKeyForModel && !chat.isStreaming
                  }
                  onSend={chat.submitChat}
                />
              )}

              {chat.messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  msg={msg}
                  isCurrentlyStreaming={
                    msg.id === chat.streamingMsgId && chat.isStreaming
                  }
                  agentSteps={chat.agentSteps}
                  blockCtx={blockCtx}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {selectedModel && !chat.hasKeyForModel && (
        <div className="mx-3 mb-2 px-3 py-2.5 rounded-md border border-border bg-muted/40 text-sm text-foreground leading-snug flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {isInferenceProviderType(selectedModel.provider) &&
            selectedModel.profileId
              ? `Configure “${getInferenceProfile(selectedModel.profileId)?.label ?? "inference"}” in Settings to send messages.`
              : `${PROVIDER_META[selectedModel.provider as keyof typeof PROVIDER_META].label} API key required to send messages.`}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="shrink-0 h-8"
            onClick={openKeysForChat}
          >
            Add API key
          </Button>
        </div>
      )}

      {chat.error && (
        <div className="mx-3 mb-2 px-3 py-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm leading-snug space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 space-y-1">
              <p>{chat.error}</p>
              <p className="text-xs text-destructive/80">
                {errorIsAuth
                  ? "This looks like an authentication issue."
                  : errorIsTransient
                    ? "This looks temporary. Try again in a moment."
                    : "This may be a provider or model issue."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {errorIsAuth ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={openKeysForChat}
              >
                Manage API keys
              </Button>
            ) : (
              <>
                {chat.canRetry && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void chat.retryLastError()}
                    disabled={chat.isStreaming}
                  >
                    Retry
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => chat.clearError()}
                >
                  Dismiss
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={openKeysForChat}
                >
                  Model & keys
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <ChatInput
        input={chat.input}
        setInput={chat.setInput}
        sendMessage={chat.sendMessage}
        isStreaming={chat.isStreaming}
        selectedModel={selectedModel}
        hasSavedKeys={chat.hasSavedKeys}
        chatThreadAnnotationId={chatThreadAnnotationId}
        onOpenSettings={openSettings}
      />
    </div>
  );
}
