"use client";

import {
  createContext,
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
  PenLine,
  Send,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type Model } from "@/lib/models";
import { getSavedSelectedModel } from "@/lib/keys";
import type { Annotation } from "@/lib/annotations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSettingsOpener } from "./settings-opener-context";
import { useCitationContext } from "./citation-context";
import { ExaKeyResumeProvider } from "./exa-key-resume-context";
import ChatEmptyState from "./chat-empty-state";
import { ChatMessageBubble } from "./chat-message-bubble";
import JournalCheckpointModal from "./journal-checkpoint-modal";
import { MonoLabel } from "@/components/folio";
import { useChat } from "@/hooks/use-chat";

// Streaming bubbles call this from a useLayoutEffect on each typewriter
// advance so the scroll runs *after* the new content has been committed
// to the DOM — reading scrollHeight in a store subscriber would catch a
// stale layout and fall behind the cursor.
export const ChatScrollContext = createContext<() => void>(() => {});

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
          className="size-3.5"
          strokeWidth={2}
          style={{ color: "color-mix(in srgb, var(--primary) 72%, transparent)" }}
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
  isPreparingPaper,
  chatThreadAnnotationId,
  focusToken,
}: {
  input: string;
  setInput: (v: string) => void;
  sendMessage: () => Promise<void>;
  isStreaming: boolean;
  selectedModel: Model | null;
  /** Paper parse hasn't finished yet — disable input with a preparing state. */
  isPreparingPaper: boolean;
  chatThreadAnnotationId: string | null;
  /** Increment to imperatively focus the composer (e.g. after a quote insert). */
  focusToken: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollComposerIntoViewRef = useRef(false);
  const { pageMapProgress, pageMapError } = useCitationContext();
  // Chat is available by default (platform key); only the paper-indexing step
  // gates input. Provider/usage failures surface inline on the message.
  const inputLocked = isPreparingPaper;

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
          isPreparingPaper
            ? "bg-muted/30 border-border/60"
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
            isPreparingPaper
              ? "Indexing paper for chat…"
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
              ? "Choose a model to send"
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
        {pageMapError && !isPreparingPaper && (
          <p className="px-1 text-center text-[11px] leading-snug text-warning">
            Page index unavailable: {pageMapError} Chat still works; citation
            chips fall back to text search.
          </p>
        )}
        {isPreparingPaper && (
          <div className="px-1">
            <p className="text-center text-[11px] leading-snug text-muted-foreground inline-flex w-full items-center justify-center gap-1.5">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Indexing paper for chat…
            </p>
            {(() => {
              const total = pageMapProgress?.total ?? 0;
              const done = pageMapProgress?.done ?? 0;
              const pct = total > 0 ? (done / total) * 100 : 0;
              return (
                <div
                  className="mx-auto mt-1.5 h-1 w-40 overflow-hidden rounded-full bg-border"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={total || 1}
                  aria-valuenow={done}
                >
                  <div
                    className="h-full bg-foreground/70 transition-[width] duration-200 ease-out"
                    style={{
                      width: `${Math.min(100, Math.max(0, pct))}%`,
                    }}
                  />
                </div>
              );
            })()}
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
  sourceUrl,
}: ChatPanelProps) {
  const { openSettings } = useSettingsOpener();
  const { parseReady } = useCitationContext();

  // The app uses one fixed model. When no model is passed in, fall back to it
  // so a standalone chat panel still works.
  const selectedModel =
    externalModel !== undefined ? externalModel : getSavedSelectedModel();

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

  // Only surface the "preparing" gate when the user could otherwise send —
  // i.e. a model is selected. Chat itself is available by default.
  const isPreparingPaper = !parseReady && !!selectedModel;

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
  // Tracks whether the view is actually at the bottom. The "jump to latest"
  // button keys off this real position rather than `pinnedToBottom`, which
  // can flip false on a mousedown even while you're sitting at the bottom.
  const [atBottom, setAtBottom] = useState(true);
  const [checkpointOpen, setCheckpointOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const handleConfirmClear = useCallback(() => {
    setPendingQuote(null);
    onChatThreadChange(null);
    void chat.clearMessages();
    setConfirmClearOpen(false);
  }, [chat, onChatThreadChange]);

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
    const el = scrollAreaRef.current;
    if (!el) return;
    if (pinnedRef.current && !(wasStreaming && !chat.isStreaming)) {
      el.scrollTop = el.scrollHeight;
    }
    // Keep the real bottom-position in sync as content grows so the
    // jump-to-latest button reflects where the view actually is.
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= 2);
  }, [chat.messages, displayThread, chat.isStreaming]);

  // Called by the streaming bubble after each typewriter advance commits.
  // Stable identity so the consumer's useLayoutEffect dep list stays clean.
  const scrollIfPinned = useCallback(() => {
    if (!pinnedRef.current) return;
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Detect user-initiated upward scrolling and unpin. Re-pin once they reach
  // the bottom again. We treat wheel/touch/keyboard as user intent; pure
  // scroll events caused by our own `scrollTop = scrollHeight` won't unpin
  // because the new scrollTop is always at the bottom.
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    // Tight epsilon: re-pinning only when the user *really* reaches the
    // bottom. A larger value caused thrash during smooth-scroll wheel
    // events — the typewriter would snap the view to the bottom each
    // frame, the scroll handler would see "near bottom" and re-pin, then
    // the next wheel event would unpin again, and so on.
    const BOTTOM_EPS = 2;

    const isAtBottom = () =>
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_EPS;

    const unpin = () => {
      if (!pinnedRef.current) return;
      // Flip the ref synchronously so the very next typewriter tick
      // (which can fire before React commits the state update) sees the
      // unpinned state and skips the auto-scroll.
      pinnedRef.current = false;
      setPinnedToBottom(false);
    };

    // Wheel-up and scroll keys mean "I want to read" — react to the intent
    // directly. We can't use a position-based check here because the
    // typewriter keeps yanking scrollTop back to the bottom every frame,
    // so smooth-scroll wheel events (e.g., trackpads) never accumulate
    // enough scroll distance to leave the bottom-epsilon window.
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) unpin();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") {
        unpin();
      }
    };
    // Touchmove has no reliable direction without tracking touchstart, so
    // treat any touch gesture on the scroll area as intent to look around.
    const onTouchMove = () => unpin();
    // Mousedown inside the scroll area = intent to interact (click a chip,
    // start a selection). Without this, the typewriter auto-scroll slides
    // chips upward between mousedown and mouseup so the click never lands.
    const onMouseDown = () => unpin();
    const onScroll = () => {
      const bottom = isAtBottom();
      setAtBottom(bottom);
      if (!pinnedRef.current && bottom) {
        pinnedRef.current = true;
        setPinnedToBottom(true);
      }
    };

    // Keydown listener on the scroll div would only fire when the div has
    // focus, which it never does (no tabIndex). Listen on the document and
    // gate on whether the event targets the chat scroll area or its
    // descendants — that way the chat composer's own ArrowUp doesn't unpin.
    const onDocumentKeyDown = (e: KeyboardEvent) => {
      if (!(e.target instanceof Node)) return;
      if (!el.contains(e.target)) return;
      onKeyDown(e);
    };

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("mousedown", onMouseDown, { passive: true });
    document.addEventListener("keydown", onDocumentKeyDown);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
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
    openSettings();
  };

  const handleRetry = useCallback(() => {
    void chat.retryLastError();
  }, [chat]);

  const buildFailure = (msgId: string) =>
    chat.failedUserMsgId === msgId && chat.error
      ? {
          error: chat.error,
          canRetry: chat.canRetry,
          onRetry: handleRetry,
          kind: chat.errorCode === "rate_limit" ? ("rate_limit" as const) : undefined,
          onAddKey: openKeysForChat,
        }
      : null;

  /* ---------------------------------------------------------------- */
  /*  JSX                                                              */
  /* ---------------------------------------------------------------- */

  return (
    <ExaKeyResumeProvider
      resumeAfterExaDecision={chat.resumeAfterExaDecision}
    >
      <div className="flex flex-col h-full min-h-0 bg-background">
        {!hideHeader && (
          <div
            className="flex h-14 shrink-0 items-center justify-between border-b px-4"
            style={{
              borderColor:
                "color-mix(in srgb, var(--border) 80%, transparent)",
              background:
                "linear-gradient(90deg, var(--background), color-mix(in srgb, var(--primary) 3%, var(--background)))",
            }}
          >
            <div className="flex flex-col gap-0.5">
              <MonoLabel>Assistant</MonoLabel>
              <span
                className="text-[15px] font-semibold tracking-[-0.018em] text-foreground"
              >
                Ask the paper
              </span>
            </div>
          </div>
        )}

        <div className="relative flex-1 min-h-0">
          <div
            ref={scrollAreaRef}
            className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain"
          >
            <ChatScrollContext.Provider value={scrollIfPinned}>
            <div className="space-y-5 px-4 pb-5 pt-5">
              {chatThreadAnnotationId && activeThreadAnn ? (
                <>
                  <div className="flex flex-col gap-2.5 border-b border-border/60 pb-4">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="-ml-2 self-start gap-1.5 text-muted-foreground hover:text-foreground"
                      onClick={() => onChatThreadChange(null)}
                      aria-label="Back to whole-paper assistant chat"
                    >
                      <ArrowLeft className="size-3" strokeWidth={2.5} />
                      Main thread
                    </Button>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                        From the paper
                      </span>
                      <blockquote
                        className="line-clamp-4 border-l-2 pl-3 text-[13px] italic leading-relaxed"
                        style={{
                          fontFamily: "var(--font-reading)",
                          borderColor:
                            "color-mix(in srgb, var(--primary) 35%, transparent)",
                          color:
                            "color-mix(in srgb, var(--foreground) 80%, transparent)",
                        }}
                      >
                        &ldquo;{activeThreadAnn.highlightText}&rdquo;
                      </blockquote>
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
                      failure={buildFailure(msg.id)}
                    />
                  ))}
                </>
              ) : (
                <>
                  {chat.messages.length === 0 && (
                    <ChatEmptyState
                      canSend={
                        !!selectedModel && !chat.isStreaming && !isPreparingPaper
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
                      failure={buildFailure(msg.id)}
                    />
                  ))}
                </>
              )}
            </div>
            </ChatScrollContext.Provider>
          </div>
          {chat.isStreaming && !atBottom && (
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


        {pendingQuote && (
          <div
            className="mx-3 mb-2 rounded-lg border px-3 py-2.5"
            style={{
              borderColor:
                "color-mix(in srgb, var(--primary) 22%, transparent)",
              background:
                "color-mix(in srgb, var(--primary) 5%, transparent)",
            }}
          >
            <div className="flex items-start gap-2">
              <MessageSquareQuote
                className="mt-0.5 size-4 shrink-0"
                strokeWidth={2}
                style={{
                  color:
                    "color-mix(in srgb, var(--primary) 72%, transparent)",
                }}
              />
              <p
                className="flex-1 text-xs leading-snug italic line-clamp-3"
                style={{
                  fontFamily: "var(--font-reading)",
                  color:
                    "color-mix(in srgb, var(--foreground) 72%, transparent)",
                }}
              >
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
            <div className="px-3 pt-1 flex justify-end gap-1">
              {chat.messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(true)}
                  disabled={chat.isStreaming}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-muted-foreground/60 transition-colors hover:bg-muted/70 hover:text-foreground/80 disabled:opacity-50"
                  title="Start a new chat"
                >
                  <PenLine className="size-2.5" strokeWidth={1.75} />
                  New chat
                </button>
              )}
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
          isPreparingPaper={isPreparingPaper}
          chatThreadAnnotationId={chatThreadAnnotationId}
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
        <Dialog
          open={confirmClearOpen}
          onOpenChange={(next) => {
            if (!next) setConfirmClearOpen(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start a new chat?</DialogTitle>
              <DialogDescription>
                This clears the current conversation. Highlighted threads on the
                paper are kept.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmClearOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmClear}>Clear chat</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ExaKeyResumeProvider>
  );
}
