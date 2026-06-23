"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getExaApiKey,
  hasUsableProvider,
  KEYS_UPDATED_EVENT,
  resolveModelCredentials,
} from "@/lib/keys";
import {
  loadConversation,
  compactConversation,
  saveMessages,
  primeMessagesCache,
  type ChatMessage,
} from "@/lib/reviews";
import type { AnnotationMessage } from "@/lib/annotations";
import { getAnnotation, updateAnnotation } from "@/lib/annotations";
import type { StreamEvent } from "@/lib/stream-types";
import {
  isLongPaper,
  parseAndCachePaper,
} from "@/lib/client/parsed-papers";
import type { ContextUsage, ParsedPaper } from "@/lib/review-types";
import { streamingStore } from "@/lib/streaming-store";
import {
  processStreamEvent,
  stepsToBlocks,
  stepsToContent,
  type AgentStep,
} from "@/lib/agent-steps";

// Step assembly moved to a shared (non-client) module so the server can run
// the same logic when it persists the assistant turn. Re-exported here so the
// long-standing `@/hooks/use-chat` import sites (and tests) keep working.
export {
  processStreamEvent,
  stepsToBlocks,
  stepsToContent,
} from "@/lib/agent-steps";
export type { AgentStep } from "@/lib/agent-steps";

/* ------------------------------------------------------------------ */
/*  Stream inactivity watchdog                                          */
/* ------------------------------------------------------------------ */

/**
 * Aborts a chat fetch if no NDJSON event arrives for `STREAM_INACTIVITY_MS`.
 * Inactivity, not wall-clock — a healthy long generation that keeps emitting
 * tokens/tool events resets the timer indefinitely. Picked above the worst
 * reasoning-pause we expect from any single LLM round.
 */
const STREAM_INACTIVITY_MS = 60_000;

function createInactivityController(message: string) {
  const controller = new AbortController();
  let timer: number | null = null;
  const noteActivity = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(
      () => controller.abort(new Error(message)),
      STREAM_INACTIVITY_MS,
    );
  };
  const dispose = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  return { signal: controller.signal, noteActivity, dispose };
}

/* ------------------------------------------------------------------ */
/*  NDJSON stream parser                                               */
/* ------------------------------------------------------------------ */

async function parseNDJSONStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: StreamEvent;
        try {
          event = JSON.parse(trimmed) as StreamEvent;
        } catch {
          continue; // skip malformed lines
        }
        onEvent(event); // exceptions propagate so callers can react to error events
      }
    }
    if (buffer.trim()) {
      let event: StreamEvent;
      try {
        event = JSON.parse(buffer.trim()) as StreamEvent;
      } catch {
        return;
      }
      onEvent(event);
    }
  } finally {
    reader.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

interface UseChatOptions {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  modelReady: boolean;
  chatThreadAnnotationId: string | null;
  onAnnotationsPersist: () => void;
  sourceUrl?: string | null;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  isStreaming: boolean;
  /** Measured context-window usage for the running meter (null until known). */
  contextUsage: ContextUsage | null;
  /** True while a compaction request is in flight. */
  isCompacting: boolean;
  /** Transient result of the last compaction (success / no-op / error), or null. */
  compactionNote: string | null;
  /** Manually compact older turns into a recap (the "Compact now" affordance). */
  compact: () => Promise<void>;
  error: string | null;
  /** "rate_limit" when the last failure was an upstream usage-limit rejection,
   *  so the UI can prompt for the user's own key instead of a generic error. */
  errorCode: "rate_limit" | null;
  /** ID of the latest user message whose send failed. Renderers attach an
   *  inline retry/error indicator to this message. */
  failedUserMsgId: string | null;
  streamingMsgId: string | null;
  hasSavedKeys: boolean;
  hasKeyForModel: boolean;
  canRetry: boolean;
  retryLastError: () => Promise<void>;
  clearError: () => void;
  sendMessage: () => Promise<void>;
  submitChat: (text: string) => Promise<void>;
  submitThreadChat: (text: string) => Promise<void>;
  displayThread: AnnotationMessage[];
  /** Wipe the main-thread conversation and persist the empty state. Selection
   *  threads on annotations are left untouched. No-op while streaming. */
  clearMessages: () => Promise<void>;
  /** Resume an assistant turn that paused waiting for the user to decide
   *  about the Exa-key card. Wired into the inline card via context. */
  resumeAfterExaDecision: (opts: { skipWebSearch: boolean }) => void;
}

export function useChat({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  modelReady,
  chatThreadAnnotationId,
  onAnnotationsPersist,
  sourceUrl,
}: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<"rate_limit" | null>(null);
  const [keysVersion, setKeysVersion] = useState(0);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [threadStream, setThreadStream] = useState<AnnotationMessage[] | null>(
    null,
  );
  const [lastFailedRequest, setLastFailedRequest] = useState<{
    text: string;
    threadAnnotationId: string | null;
    /** Main-chat only: id of the user message to re-run on retry, so the
     *  server dedupes instead of appending a duplicate turn. */
    userMsgId?: string;
  } | null>(null);
  /** ID of the latest user message whose send failed — drives the inline
   *  failure indicator/retry button on the message itself. Cleared on the
   *  next successful submit. */
  const [failedUserMsgId, setFailedUserMsgId] = useState<string | null>(null);
  /** Measured context-window usage for the running meter. Seeded from the
   *  server on load and refreshed by `context_usage` stream events. */
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  /** Transient one-line result of the last compaction, shown by the meter so a
   *  manual "Compact" click always has visible feedback (even a no-op). */
  const [compactionNote, setCompactionNote] = useState<string | null>(null);
  // Guards so an in-flight compaction never double-fires, and so a compaction
  // that can't reduce usage (e.g. a huge paper dominates the window) doesn't
  // auto-loop — we only retry once usage climbs past the last attempt.
  const isCompactingRef = useRef(false);
  const lastCompactAttemptTokens = useRef(0);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashNote = useCallback((msg: string) => {
    setCompactionNote(msg);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setCompactionNote(null), 4000);
  }, []);
  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );

  // Load messages + context usage on review change
  useEffect(() => {
    let cancelled = false;
    setContextUsage(null);
    lastCompactAttemptTokens.current = 0;
    void loadConversation(reviewId).then(({ messages: rows, contextUsage: cu }) => {
      if (cancelled) return;
      setMessages(rows);
      setContextUsage(cu);
    });
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  // Listen for API key changes
  useEffect(() => {
    const onKeys = () => setKeysVersion((v) => v + 1);
    window.addEventListener(KEYS_UPDATED_EVENT, onKeys);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, onKeys);
  }, []);

  // The server now persists each main-chat turn authoritatively. The client
  // only keeps its in-memory cache in sync so a remount within the same
  // session doesn't read a stale snapshot — no network write here. Explicit
  // client-initiated writes (clearing the conversation) still use saveMessages.
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      primeMessagesCache(reviewId, messages);
    }
  }, [messages, isStreaming, reviewId]);

  // Reset thread stream on annotation switch
  useEffect(() => {
    setThreadStream(null);
  }, [chatThreadAnnotationId]);

  // Consume keysVersion to avoid lint warning
  void keysVersion;

  // "Has a usable provider" — own key, inference profile, or platform
  // fallback. Drives the chat input lock; a fresh user with a fallback
  // is not locked out.
  const hasSavedKeys = hasUsableProvider();
  const hasKeyForModel = modelReady && hasUsableProvider();

  /**
   * Decide what paper payload to send to /api/chat. Short papers go in as
   * `paperContext` (full text) — the historical behavior. Long papers are
   * parsed once and sent as `parsedPaper`, with sections fetched on demand
   * via tools. Parse-on-first-use; cached in IndexedDB so repeat opens are
   * free. If parsing fails, fall back to sending the full text and let the
   * server cap or the model truncate — degrading is preferable to blocking
   * chat on a parse error.
   */
  const buildPaperPayload = useCallback(
    async (): Promise<{
      paperContext?: string;
      parsedPaper?: ParsedPaper;
    }> => {
      if (!paperContext) return {};
      if (!isLongPaper(paperContext)) return { paperContext };
      if (!modelReady) return { paperContext };

      const creds = resolveModelCredentials();

      try {
        const parsed = await parseAndCachePaper(paperContext, {
          apiKey: creds.apiKey,
        });
        return { parsedPaper: parsed };
      } catch (err) {
        // Best-effort fallback: still chat, just with truncated/full text.
        console.warn("Paper parse failed, sending full text instead:", err);
        return { paperContext };
      }
    },
    [paperContext, modelReady],
  );

  /* ---------------------------------------------------------------- */
  /*  Main chat submit                                                 */
  /* ---------------------------------------------------------------- */

  const submitChat = useCallback(
    async (
      text: string,
      opts?: {
        /**
         * Re-run an already-stored user message instead of appending a new
         * one (Exa resume + error retry). The server dedupes on this id, so
         * re-sending it never creates a duplicate turn.
         */
        existingUserMsgId?: string;
        /** Tell the server not to register web_search for this turn. Used
         *  after the user dismisses the Exa card. */
        skipWebSearch?: boolean;
      },
    ) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || !modelReady) return;

      // No client-side key gate: the platform key covers chat by default, and
      // if a send genuinely can't be served (e.g. rate limit) the failure
      // surfaces inline beneath the message — see the catch below.
      setError(null);
      setErrorCode(null);
      setLastFailedRequest(null);
      setFailedUserMsgId(null);

      const isResume = !!opts?.existingUserMsgId;
      const userMsgId = opts?.existingUserMsgId ?? crypto.randomUUID();
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      };

      // Fresh submit appends the user bubble + an assistant placeholder. A
      // resume re-runs an existing user message (already in the list and the
      // DB), so only the placeholder is added — the caller has already dropped
      // any stale trailing assistant.
      if (isResume) {
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        const userMsg: ChatMessage = {
          id: userMsgId,
          role: "user",
          content: text,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
      }
      setIsStreaming(true);
      setStreamingMsgId(assistantMsg.id);
      streamingStore.set([]);

      let steps: AgentStep[] = [];
      let rafId: number | null = null;
      const inactivity = createInactivityController(
        "Chat stalled — no response from the model for 60 seconds.",
      );

      try {
        const paperPayload = await buildPaperPayload();
        const exaKey = getExaApiKey();
        inactivity.noteActivity();
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // Server-owned conversation: send only this turn. The server loads
            // history from the DB, appends + persists it, budgets to the
            // model's window, and persists the reply. Re-sending the same
            // `userMessageId` is idempotent — the server re-runs the stored
            // turn rather than duplicating it (powers Exa-resume + retry).
            reviewId,
            userMessage: text,
            userMessageId: userMsgId,
            assistantMessageId: assistantMsg.id,
            ...resolveModelCredentials(),
            ...paperPayload,
            paperTitle,
            arxivId,
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(exaKey ? { exaApiKey: exaKey } : {}),
            ...(opts?.skipWebSearch ? { skipWebSearch: true } : {}),
          }),
          signal: inactivity.signal,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const e = new Error(data.error || `Request failed: ${response.status}`);
          if (response.status === 429 || response.status === 402) {
            (e as { code?: string }).code = "rate_limit";
          }
          throw e;
        }

        if (!response.body) throw new Error("No response body received");

        await parseNDJSONStream(response.body, (event) => {
          inactivity.noteActivity();
          if (event.type === "error") {
            // Throw so the catch block handles cleanup uniformly with HTTP errors.
            const e = new Error(event.message);
            if (event.code) (e as { code?: string }).code = event.code;
            throw e;
          }
          if (event.type === "context_usage") {
            // Not a render step — drives the usage meter / auto-compaction.
            setContextUsage({
              usedTokens: event.usedTokens,
              windowTokens: event.windowTokens,
              shouldCompact: event.shouldCompact,
            });
            return;
          }
          steps = processStreamEvent(steps, event);
          // Batch state flushes to one per animation frame. Without this,
          // every token re-renders the message and re-parses the full
          // accumulated markdown, which is what makes streaming feel chunky.
          if (rafId === null) {
            rafId = requestAnimationFrame(() => {
              rafId = null;
              streamingStore.set([...steps]);
            });
          }
        });

        const blocks = stepsToBlocks(steps);
        const content = stepsToContent(steps);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content,
                  blocks: blocks.length > 0 ? blocks : undefined,
                }
              : m,
          ),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        const code = (err as { code?: string })?.code;
        // Drop the empty assistant placeholder — never repurpose it for an
        // error, since it visually masquerades as a real reply. The user
        // message stays (the server already persisted it up front); retry
        // re-runs it by id. The failure is surfaced inline beneath it.
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
        setError(message);
        setErrorCode(code === "rate_limit" ? "rate_limit" : null);
        setFailedUserMsgId(userMsgId);
        setLastFailedRequest({
          text: trimmed,
          threadAnnotationId: null,
          userMsgId,
        });
      } finally {
        inactivity.dispose();
        if (rafId !== null) cancelAnimationFrame(rafId);
        setIsStreaming(false);
        setStreamingMsgId(null);
        streamingStore.set([]);
      }
    },
    [
      isStreaming,
      modelReady,
      buildPaperPayload,
      paperTitle,
      arxivId,
      reviewId,
      sourceUrl,
    ],
  );

  /* ---------------------------------------------------------------- */
  /*  Resume after the Exa-key card was actioned                       */
  /* ---------------------------------------------------------------- */

  /**
   * Re-runs the chat agent on the user's last message after the Exa-key
   * configure card has been actioned. Removes the previous (incomplete)
   * assistant message that contained the card, keeps the original user
   * message, and re-submits — passing `skipWebSearch: true` when the user
   * dismissed (so the tool isn't even registered).
   *
   * Called from `ExaKeyResumeProvider` (set up by ChatPanel). No-op when
   * we can't find a user message to retry.
   */
  const resumeAfterExaDecision = useCallback(
    ({ skipWebSearch }: { skipWebSearch: boolean }) => {
      if (isStreaming) return;

      // Find the most recent user message and drop everything after it.
      let lastUserIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      if (lastUserIdx < 0) return;

      const userMsg = messages[lastUserIdx];
      // Drop the paused/incomplete assistant turn (the one showing the card);
      // keep up through the user message. The server still holds the history,
      // so re-running by id is enough — no need to ship it back.
      setMessages(messages.slice(0, lastUserIdx + 1));

      void submitChat(userMsg.content, {
        existingUserMsgId: userMsg.id,
        skipWebSearch,
      });
    },
    [isStreaming, messages, submitChat],
  );

  /* ---------------------------------------------------------------- */
  /*  Selection thread submit                                          */
  /* ---------------------------------------------------------------- */

  const submitThreadChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || !modelReady || !chatThreadAnnotationId)
        return;

      const ann = await getAnnotation(reviewId, chatThreadAnnotationId);
      if (!ann || ann.kind !== "ask_ai") return;

      setError(null);
      setErrorCode(null);
      setLastFailedRequest(null);
      setFailedUserMsgId(null);

      const userMsg: AnnotationMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      const assistantMsg: AnnotationMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      };

      // Persist the user message immediately so it isn't lost, but keep
      // the assistant placeholder in UI-only state until streaming finishes.
      const threadWithUser = [...ann.thread, userMsg];
      await updateAnnotation(reviewId, chatThreadAnnotationId, {
        thread: threadWithUser,
      });
      onAnnotationsPersist();

      let thread: AnnotationMessage[] = [...threadWithUser, assistantMsg];
      setThreadStream(thread);

      setIsStreaming(true);
      setStreamingMsgId(assistantMsg.id);
      streamingStore.set([]);

      // Prepend the highlighted passage so the LLM knows what the thread is about.
      const highlightPreamble = ann.highlightText
        ? `[The user highlighted this passage for discussion:]\n"${ann.highlightText}"\n\n`
        : "";
      const historyForApi = threadWithUser.map((m, i) => ({
        role: m.role,
        content:
          i === 0 && m.role === "user"
            ? highlightPreamble + m.content
            : m.content,
        // Replay the assistant's prior tool work in this thread too.
        ...(m.blocks ? { blocks: m.blocks } : {}),
      }));

      let steps: AgentStep[] = [];
      let rafId: number | null = null;
      const inactivity = createInactivityController(
        "Chat stalled — no response from the model for 60 seconds.",
      );

      try {
        const paperPayload = await buildPaperPayload();
        const exaKey = getExaApiKey();
        inactivity.noteActivity();
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: historyForApi,
            ...resolveModelCredentials(),
            ...paperPayload,
            paperTitle,
            arxivId,
            reviewId,
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(exaKey ? { exaApiKey: exaKey } : {}),
          }),
          signal: inactivity.signal,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const e = new Error(data.error || `Request failed: ${response.status}`);
          if (response.status === 429 || response.status === 402) {
            (e as { code?: string }).code = "rate_limit";
          }
          throw e;
        }

        if (!response.body) throw new Error("No response body received");

        await parseNDJSONStream(response.body, (event) => {
          inactivity.noteActivity();
          if (event.type === "error") {
            const e = new Error(event.message);
            if (event.code) (e as { code?: string }).code = event.code;
            throw e;
          }
          steps = processStreamEvent(steps, event);
          if (rafId === null) {
            rafId = requestAnimationFrame(() => {
              rafId = null;
              streamingStore.set([...steps]);
            });
          }
        });

        const blocks = stepsToBlocks(steps);
        const content = stepsToContent(steps);

        thread = thread.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content, blocks: blocks.length > 0 ? blocks : undefined }
            : m,
        );
        setThreadStream(thread);
        await updateAnnotation(reviewId, chatThreadAnnotationId, { thread });
        onAnnotationsPersist();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        const code = (err as { code?: string })?.code;
        // On error, roll back to the thread with only the user message —
        // don't persist an empty/broken assistant placeholder to the DB.
        thread = threadWithUser;
        await updateAnnotation(reviewId, chatThreadAnnotationId, { thread });
        onAnnotationsPersist();
        setThreadStream(thread);
        setError(message);
        setErrorCode(code === "rate_limit" ? "rate_limit" : null);
        setFailedUserMsgId(userMsg.id);
        setLastFailedRequest({
          text: trimmed,
          threadAnnotationId: chatThreadAnnotationId,
        });
      } finally {
        inactivity.dispose();
        if (rafId !== null) cancelAnimationFrame(rafId);
        setIsStreaming(false);
        setStreamingMsgId(null);
        streamingStore.set([]);
        setThreadStream(null);
      }
    },
    [
      isStreaming,
      modelReady,
      chatThreadAnnotationId,
      reviewId,
      arxivId,
      paperTitle,
      buildPaperPayload,
      onAnnotationsPersist,
      sourceUrl,
    ],
  );

  const clearMessages = useCallback(async () => {
    if (isStreaming) return;
    setMessages([]);
    setInput("");
    setError(null);
    setErrorCode(null);
    setFailedUserMsgId(null);
    setLastFailedRequest(null);
    streamingStore.set([]);
    setStreamingMsgId(null);
    setContextUsage(null);
    lastCompactAttemptTokens.current = 0;
    await saveMessages(reviewId, []);
  }, [isStreaming, reviewId]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (chatThreadAnnotationId) {
      await submitThreadChat(text);
    } else {
      await submitChat(text);
    }
  }, [input, submitChat, submitThreadChat, chatThreadAnnotationId]);

  const retryLastError = useCallback(async () => {
    if (!lastFailedRequest || isStreaming) return;
    const { text, threadAnnotationId, userMsgId } = lastFailedRequest;
    if (threadAnnotationId) {
      if (chatThreadAnnotationId !== threadAnnotationId) {
        setError("Retry this message from the original selection thread.");
        return;
      }
      await submitThreadChat(text);
      return;
    }
    // Re-run the stored user message by id so the server dedupes rather than
    // appending a duplicate turn.
    await submitChat(text, userMsgId ? { existingUserMsgId: userMsgId } : undefined);
  }, [
    lastFailedRequest,
    isStreaming,
    chatThreadAnnotationId,
    submitThreadChat,
    submitChat,
  ]);

  // Compact older turns into a recap (Claude Code-style). Idempotent + guarded:
  // never overlaps a stream or another compaction, and records the usage level
  // it ran at so it can't auto-loop when compaction can't reduce the window
  // (e.g. a large paper dominates context).
  const compact = useCallback(async () => {
    if (isCompactingRef.current || isStreaming) return;
    isCompactingRef.current = true;
    setIsCompacting(true);
    lastCompactAttemptTokens.current = contextUsage?.usedTokens ?? 0;
    try {
      const { status, contextUsage: cu } = await compactConversation(
        reviewId,
        resolveModelCredentials().apiKey || undefined,
      );
      if (cu) setContextUsage(cu);
      flashNote(
        status === "compacted"
          ? "Compacted earlier messages."
          : status === "already"
            ? "Already compact — nothing new to summarize."
            : "Nothing old enough to compact yet.",
      );
    } catch {
      flashNote("Couldn't compact — please try again.");
    } finally {
      isCompactingRef.current = false;
      setIsCompacting(false);
    }
  }, [reviewId, isStreaming, contextUsage, flashNote]);

  // Auto-compact at the threshold, the moment the chat is idle. Only re-fires
  // once usage climbs past the last attempt, so a no-op compaction can't loop.
  useEffect(() => {
    if (!contextUsage?.shouldCompact || isStreaming || isCompacting) return;
    if (contextUsage.usedTokens <= lastCompactAttemptTokens.current) return;
    void compact();
  }, [contextUsage, isStreaming, isCompacting, compact]);

  return {
    messages,
    input,
    setInput,
    isStreaming,
    contextUsage,
    isCompacting,
    compactionNote,
    compact,
    error,
    errorCode,
    failedUserMsgId,
    streamingMsgId,
    hasSavedKeys,
    hasKeyForModel,
    canRetry: !!lastFailedRequest,
    retryLastError,
    clearError: () => {
      setError(null);
      setErrorCode(null);
      setFailedUserMsgId(null);
      setLastFailedRequest(null);
    },
    sendMessage,
    submitChat,
    submitThreadChat,
    displayThread: threadStream ?? [],
    clearMessages,
    resumeAfterExaDecision,
  };
}
