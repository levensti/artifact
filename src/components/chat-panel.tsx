"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowLeft,
  BookmarkPlus,
  Loader2,
  MessageSquareQuote,
  Send,
  X,
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
import { BraveKeyResumeProvider } from "./brave-key-resume-context";
import ChatEmptyState from "./chat-empty-state";
import { ChatMessageBubble, type BlockCtx } from "./chat-message-bubble";
import JournalCheckpointModal from "./journal-checkpoint-modal";
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
/*  Quote-in-reply popover                                             */
/* ------------------------------------------------------------------ */

function ChatQuotePopover({
  rect,
  onQuote,
}: {
  rect: DOMRect;
  onQuote: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Render via portal to <body> so no ancestor's transform/overflow can move
  // or clip the popover. Measure the popover's width on first paint, then
  // clamp horizontally so neither edge spills past the viewport. Vertically,
  // prefer below the selection but flip above if there's no room.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    setSize({ w: ref.current.offsetWidth, h: ref.current.offsetHeight });
  }, []);

  const vw = typeof window !== "undefined" ? window.innerWidth : 400;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const pad = 8;
  const gap = 10;

  let leftPx = rect.left + rect.width / 2;
  let topPx = rect.bottom + gap;

  if (size) {
    // Horizontal: clamp the popover's left edge into the viewport.
    leftPx = Math.max(pad, Math.min(vw - size.w - pad, leftPx - size.w / 2));
    // Vertical: flip above if it would overflow the bottom.
    if (topPx + size.h + pad > vh) {
      topPx = Math.max(pad, rect.top - size.h - gap);
    }
  }

  const node = (
    <div
      ref={ref}
      data-chat-quote-popover
      className="fixed z-[60] animate-in fade-in slide-in-from-bottom-1 duration-150"
      style={{
        top: `${topPx}px`,
        left: `${leftPx}px`,
        visibility: size ? "visible" : "hidden",
      }}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onQuote}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-md transition-colors hover:bg-accent"
      >
        <MessageSquareQuote
          className="size-3.5 text-sky-600/90"
          strokeWidth={2}
        />
        Quote in reply
      </button>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
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
  focusToken,
}: {
  input: string;
  setInput: (v: string) => void;
  sendMessage: () => Promise<void>;
  isStreaming: boolean;
  selectedModel: Model | null;
  hasSavedKeys: boolean;
  chatThreadAnnotationId: string | null;
  onOpenSettings: () => void;
  /** Increment to imperatively focus the composer (e.g. after a quote insert). */
  focusToken: number;
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

  // Focus the composer when entering a selection thread (e.g. after "Dive
  // deeper") so the user can start typing without an extra click.
  useEffect(() => {
    if (!chatThreadAnnotationId || inputLocked) return;
    textareaRef.current?.focus();
  }, [chatThreadAnnotationId, inputLocked]);

  // Imperative focus on demand (e.g. after the parent inserts a quoted
  // snippet). Place caret at the end so the user types right after the quote.
  useEffect(() => {
    if (focusToken === 0 || inputLocked) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }, [focusToken, inputLocked]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="p-3 shrink-0 bg-linear-to-t from-background via-background to-transparent">
      <div
        className={cn(
          "flex items-end gap-2 rounded-xl border transition-[box-shadow,border-color,background-color] duration-200",
          inputLocked
            ? "border-warning/35 bg-warning/5"
            : "bg-card border-border shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/20 focus-within:shadow-md focus-within:shadow-primary/5",
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
          className={cn(
            "size-8 m-1.5 rounded-lg transition-all duration-200",
            input.trim() && !inputLocked && selectedModel && !isStreaming
              ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
              : "bg-primary/10 text-primary hover:bg-primary/20",
          )}
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
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
        </Button>
      </div>
      <div className="mt-1.5 space-y-0.5">
        {inputLocked && (
          <p className="px-1 text-center text-[11px] leading-snug text-warning">
            Chat is locked until you add an API key.
          </p>
        )}
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
  const [composerFocusToken, setComposerFocusToken] = useState(0);
  const [snippetSel, setSnippetSel] = useState<{
    rect: DOMRect;
    text: string;
  } | null>(null);
  // Quoted snippet attached to the next outbound message. Rendered as a chip
  // above the composer (not injected into the textarea) so the user sees a
  // styled quote, not raw `>` markdown characters.
  const [pendingQuote, setPendingQuote] = useState<string | null>(null);
  // Sticky-bottom autoscroll: pin to the bottom while streaming, but as soon
  // as the user scrolls up (wheel/touch/keyboard) unpin and let them read.
  // Re-pin only when they scroll back to the bottom themselves. `pinnedRef`
  // mirrors `pinned` for use inside imperative effects without re-binding.
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const pinnedRef = useRef(true);
  useEffect(() => {
    pinnedRef.current = pinnedToBottom;
  }, [pinnedToBottom]);
  const [checkpointOpen, setCheckpointOpen] = useState(false);

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

  // Auto-scroll while pinned. We don't read scrollTop here — `pinned` is the
  // single source of truth, updated by the user-intent listeners below.
  // Exception: skip the streaming→complete transition. When isStreaming flips
  // false the bubble re-renders from a live preview to its persisted blocks,
  // which often grows the content height a bit. Snapping to that new bottom
  // mid-read feels jarring even if the user never scrolled — so we leave the
  // scroll position alone for that one tick.
  const wasStreamingRef = useRef(false);
  useLayoutEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = chat.isStreaming;
    if (!pinnedRef.current) return;
    if (wasStreaming && !chat.isStreaming) return;
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.agentSteps, displayThread, chat.isStreaming]);

  // Detect user-initiated upward scrolling and unpin. Re-pin once they reach
  // the bottom again. We treat wheel/touch/keyboard as user intent; pure
  // scroll events caused by our own `scrollTop = scrollHeight` won't unpin
  // because the new scrollTop is always at the bottom.
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const BOTTOM_EPS = 16;

    const isAtBottom = () =>
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_EPS;

    const onUserIntent = () => {
      if (pinnedRef.current && !isAtBottom()) setPinnedToBottom(false);
    };
    const onScroll = () => {
      // Re-pin when the user scrolls all the way to the bottom themselves.
      if (!pinnedRef.current && isAtBottom()) setPinnedToBottom(true);
    };

    el.addEventListener("wheel", onUserIntent, { passive: true });
    el.addEventListener("touchmove", onUserIntent, { passive: true });
    el.addEventListener("keydown", onUserIntent);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onUserIntent);
      el.removeEventListener("touchmove", onUserIntent);
      el.removeEventListener("keydown", onUserIntent);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setPinnedToBottom(true);
  }, []);

  // Reset thread when annotation is gone
  useEffect(() => {
    if (chatThreadAnnotationId && !activeThreadAnn) {
      onChatThreadChange(null);
    }
  }, [chatThreadAnnotationId, activeThreadAnn, onChatThreadChange]);

  // Escape key exits thread back to main conversation
  useEffect(() => {
    if (!chatThreadAnnotationId) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onChatThreadChange(null);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [chatThreadAnnotationId, onChatThreadChange]);

  // Scroll to top on new thread
  useEffect(() => {
    if (!chatThreadAnnotationId) return;
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [chatThreadAnnotationId]);

  // A pending quote belongs to whichever thread the user was in when they
  // captured it; switching threads should drop it. Done via the
  // previous-state comparison pattern (cheaper than an effect).
  const [prevThreadId, setPrevThreadId] = useState(chatThreadAnnotationId);
  if (prevThreadId !== chatThreadAnnotationId) {
    setPrevThreadId(chatThreadAnnotationId);
    setPendingQuote(null);
  }

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

  // Track text selections inside the chat scroll area so the user can quote
  // a snippet of an assistant reply into the composer instead of copy/paste.
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // Ignore mouseups on the popover itself — we read snippetSel on click.
      const target = e.target as Node | null;
      if (
        target instanceof Element &&
        target.closest("[data-chat-quote-popover]")
      ) {
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setSnippetSel(null);
        return;
      }
      const text = sel.toString().trim();
      if (!text) {
        setSnippetSel(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const scroll = scrollAreaRef.current;
      if (!scroll) return;
      const anchor =
        range.commonAncestorContainer.nodeType === 1
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
      if (!anchor || !scroll.contains(anchor)) {
        setSnippetSel(null);
        return;
      }
      setSnippetSel({ rect: range.getBoundingClientRect(), text });
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // Clear the popover when the user scrolls the chat (the rect would drift).
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const onScroll = () => setSnippetSel(null);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const handleQuoteSelection = useCallback(() => {
    if (!snippetSel) return;
    setPendingQuote(snippetSel.text);
    setComposerFocusToken((t) => t + 1);
    setSnippetSel(null);
    window.getSelection()?.removeAllRanges();
  }, [snippetSel]);

  // Send wrapper that prepends the pending quote (as markdown blockquote)
  // to the user's text, then routes via the same submit path sendMessage
  // would have used.
  const sendWithQuote = useCallback(async () => {
    if (!pendingQuote) {
      await chat.sendMessage();
      return;
    }
    const raw = chat.input.trim();
    const quoted = pendingQuote
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const text = raw ? `${quoted}\n\n${raw}` : quoted;
    chat.setInput("");
    setPendingQuote(null);
    if (chatThreadAnnotationId) {
      await chat.submitThreadChat(text);
    } else {
      await chat.submitChat(text);
    }
  }, [pendingQuote, chat, chatThreadAnnotationId]);

  const openKeysForChat = () => {
    if (selectedModel) openSettings({ provider: selectedModel.provider });
    else openSettings();
  };

  const handleRetry = useCallback(() => {
    void chat.retryLastError();
  }, [chat]);

  const buildFailure = (msgId: string) =>
    chat.failedUserMsgId === msgId && chat.error
      ? { error: chat.error, canRetry: chat.canRetry, onRetry: handleRetry }
      : null;

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
    <BraveKeyResumeProvider
      resumeAfterBraveDecision={chat.resumeAfterBraveDecision}
    >
      <div className="flex flex-col h-full min-h-0 bg-background">
        {!hideHeader && (
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-linear-to-r from-background to-primary/3 px-4">
            <span className="text-sm font-bold tracking-tight text-foreground">
              Assistant
            </span>
            <ModelSelector
              selected={selectedModel}
              onSelect={setSelectedModel}
            />
          </div>
        )}

        <div className="relative flex-1 min-h-0">
          <div
            ref={scrollAreaRef}
            className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain"
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
                      <ArrowLeft
                        className="size-3.5 shrink-0"
                        strokeWidth={2.5}
                      />
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
                      failure={buildFailure(msg.id)}
                    />
                  ))}
                </>
              ) : (
                <>
                  {chat.messages.length === 0 && (
                    <ChatEmptyState
                      canSend={
                        !!selectedModel &&
                        chat.hasKeyForModel &&
                        !chat.isStreaming
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
                      failure={buildFailure(msg.id)}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
          {chat.isStreaming && !pinnedToBottom && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-md backdrop-blur transition-colors hover:bg-card"
              aria-label="Jump to latest message"
            >
              <ArrowDown className="size-3.5" strokeWidth={2.25} />
              Jump to latest
            </button>
          )}
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

        {pendingQuote && (
          <div className="mx-3 mb-2 rounded-lg border border-sky-500/25 bg-sky-500/6 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <MessageSquareQuote
                className="mt-0.5 size-4 shrink-0 text-sky-600/90"
                strokeWidth={2}
              />
              <p className="flex-1 text-xs italic leading-snug text-muted-foreground line-clamp-3">
                &ldquo;{pendingQuote}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setPendingQuote(null)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                aria-label="Remove quoted snippet"
              >
                <X className="size-3.5" strokeWidth={2.25} />
              </button>
            </div>
          </div>
        )}
        {!chatThreadAnnotationId &&
          (chat.messages.length > 0 ||
            annotations.some(
              (a) => a.kind === "ask_ai" && a.thread.length > 0,
            )) && (
            <div className="px-3 pt-1 flex justify-end">
              <button
                type="button"
                onClick={() => setCheckpointOpen(true)}
                disabled={chat.isStreaming}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-muted-foreground/60 transition-colors hover:bg-muted/70 hover:text-foreground/80 disabled:opacity-50"
                title="Summarize this chat into a journal entry"
              >
                <BookmarkPlus className="size-2.5" strokeWidth={1.75} />
                Jot a journal entry
              </button>
            </div>
          )}
        <ChatInput
          input={chat.input}
          setInput={chat.setInput}
          sendMessage={sendWithQuote}
          isStreaming={chat.isStreaming}
          selectedModel={selectedModel}
          hasSavedKeys={chat.hasSavedKeys}
          chatThreadAnnotationId={chatThreadAnnotationId}
          onOpenSettings={openSettings}
          focusToken={composerFocusToken}
        />
        {snippetSel && (
          <ChatQuotePopover
            rect={snippetSel.rect}
            onQuote={handleQuoteSelection}
          />
        )}
        {checkpointOpen ? (
          <JournalCheckpointModal
            reviewId={reviewId}
            arxivId={arxivId}
            paperTitle={paperTitle}
            annotations={annotations}
            selectedModel={selectedModel}
            onClose={() => setCheckpointOpen(false)}
          />
        ) : null}
      </div>
    </BraveKeyResumeProvider>
  );
}
