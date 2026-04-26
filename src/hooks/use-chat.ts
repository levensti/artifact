"use client";

import { useCallback, useEffect, useState } from "react";
import type { Model } from "@/lib/models";
import {
  getBraveSearchApiKey,
  hasAnySavedApiKey,
  isModelReady,
  KEYS_UPDATED_EVENT,
  resolveModelCredentials,
} from "@/lib/keys";
import {
  loadMessages,
  saveMessages,
  type ChatAssistantBlock,
  type ChatMessage,
} from "@/lib/reviews";
import {
  invalidateExploreCache,
  saveRelatedPapersFromAssistant,
} from "@/lib/client-data";
import { scheduleJournalAfterChat } from "@/lib/wiki-journal-agent";
import type { AnnotationMessage } from "@/lib/annotations";
import { getAnnotation, updateAnnotation } from "@/lib/annotations";
import type { StreamEvent } from "@/lib/stream-types";
import {
  isLongPaper,
  parseAndCachePaper,
} from "@/lib/client/parsed-papers";
import type { ParsedPaper } from "@/lib/review-types";

/* ------------------------------------------------------------------ */
/*  Agent step types (used during streaming for progressive rendering) */
/* ------------------------------------------------------------------ */

export type AgentStep =
  | { kind: "thinking" }
  | { kind: "text"; text: string }
  | {
      kind: "tool_call";
      id: string;
      name: string;
      input: Record<string, unknown>;
      output?: string;
    };

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
/*  Stream event → agent steps                                         */
/* ------------------------------------------------------------------ */

export function processStreamEvent(
  steps: AgentStep[],
  event: StreamEvent,
): AgentStep[] {
  const next = [...steps];

  switch (event.type) {
    case "turn_start": {
      const last = next[next.length - 1];
      if (last && last.kind === "tool_call" && last.output !== undefined) {
        next.push({ kind: "thinking" });
      } else if (next.length === 0) {
        next.push({ kind: "thinking" });
      }
      break;
    }

    case "text_delta": {
      if (next.length > 0 && next[next.length - 1].kind === "thinking") {
        next.pop();
      }
      const last = next[next.length - 1];
      if (last && last.kind === "text") {
        next[next.length - 1] = { kind: "text", text: last.text + event.text };
      } else {
        next.push({ kind: "text", text: event.text });
      }
      break;
    }

    case "tool_call": {
      if (next.length > 0 && next[next.length - 1].kind === "thinking") {
        next.pop();
      }
      next.push({
        kind: "tool_call",
        id: event.id,
        name: event.name,
        input: event.input,
      });
      break;
    }

    case "tool_result": {
      for (let i = next.length - 1; i >= 0; i--) {
        const step = next[i];
        if (step.kind === "tool_call" && step.id === event.id) {
          next[i] = { ...step, output: event.output };
          break;
        }
      }
      break;
    }

    case "done": {
      if (next.length > 0 && next[next.length - 1].kind === "thinking") {
        next.pop();
      }
      break;
    }
  }

  return next;
}

/* ------------------------------------------------------------------ */
/*  Steps → persistence helpers                                        */
/* ------------------------------------------------------------------ */

/** Convert agent steps to ordered blocks for persistence. */
export function stepsToBlocks(steps: AgentStep[]): ChatAssistantBlock[] {
  const blocks: ChatAssistantBlock[] = [];
  for (const step of steps) {
    if (step.kind === "text" && step.text) {
      blocks.push({ type: "text_segment", content: step.text });
    } else if (step.kind === "tool_call") {
      blocks.push({
        type: "tool_call",
        id: step.id,
        name: step.name,
        input: step.input,
        output: step.output,
      });
    }
  }
  return blocks;
}

/** Extract concatenated text from steps (for the content field). */
export function stepsToContent(steps: AgentStep[]): string {
  return steps
    .filter((s): s is AgentStep & { kind: "text" } => s.kind === "text")
    .map((s) => s.text)
    .join("");
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

interface UseChatOptions {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  selectedModel: Model | null;
  chatThreadAnnotationId: string | null;
  onAnnotationsPersist: () => void;
  sourceUrl?: string | null;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  isStreaming: boolean;
  error: string | null;
  /** ID of the latest user message whose send failed. Renderers attach an
   *  inline retry/error indicator to this message. */
  failedUserMsgId: string | null;
  agentSteps: AgentStep[];
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
  /** Resume an assistant turn that paused waiting for the user to decide
   *  about the Brave-key card. Wired into the inline card via context. */
  resumeAfterBraveDecision: (opts: { skipWebSearch: boolean }) => void;
}

export function useChat({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  selectedModel,
  chatThreadAnnotationId,
  onAnnotationsPersist,
  sourceUrl,
}: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keysVersion, setKeysVersion] = useState(0);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [threadStream, setThreadStream] = useState<AnnotationMessage[] | null>(
    null,
  );
  const [lastFailedRequest, setLastFailedRequest] = useState<{
    text: string;
    threadAnnotationId: string | null;
  } | null>(null);
  /** ID of the latest user message whose send failed — drives the inline
   *  failure indicator/retry button on the message itself. Cleared on the
   *  next successful submit. */
  const [failedUserMsgId, setFailedUserMsgId] = useState<string | null>(null);

  // Load messages on review change
  useEffect(() => {
    let cancelled = false;
    void loadMessages(reviewId).then((rows) => {
      if (!cancelled) setMessages(rows);
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

  // Persist messages after streaming finishes
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      void saveMessages(reviewId, messages);
    }
  }, [messages, isStreaming, reviewId]);

  // Reset thread stream on annotation switch
  useEffect(() => {
    setThreadStream(null);
  }, [chatThreadAnnotationId]);

  // Consume keysVersion to avoid lint warning
  void keysVersion;

  const hasSavedKeys = hasAnySavedApiKey();
  const hasKeyForModel = selectedModel != null && isModelReady(selectedModel);

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
      if (!selectedModel) return { paperContext };

      const creds = resolveModelCredentials(selectedModel);
      if (!creds) return { paperContext };

      try {
        const parsed = await parseAndCachePaper(paperContext, {
          model: selectedModel.modelId,
          provider: selectedModel.provider,
          apiKey: creds.apiKey,
          apiBaseUrl: creds.apiBaseUrl,
        });
        return { parsedPaper: parsed };
      } catch (err) {
        // Best-effort fallback: still chat, just with truncated/full text.
        console.warn("Paper parse failed, sending full text instead:", err);
        return { paperContext };
      }
    },
    [paperContext, selectedModel],
  );

  /* ---------------------------------------------------------------- */
  /*  Main chat submit                                                 */
  /* ---------------------------------------------------------------- */

  const submitChat = useCallback(
    async (
      text: string,
      opts?: {
        /** Reuse this existing user message id instead of appending a new one. Used by resume flows. */
        existingUserMsgId?: string;
        /**
         * Explicit message history to send to the server. Used by resume
         * flows so the truncation done before retry isn't subject to React
         * state-update timing. Should already include the user message.
         */
        historyOverride?: ChatMessage[];
        /** Tell the server not to register web_search for this turn. Used after the user dismisses the Brave card. */
        skipWebSearch?: boolean;
      },
    ) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || !selectedModel) return;

      if (!isModelReady(selectedModel)) return;

      setError(null);
      setLastFailedRequest(null);
      setFailedUserMsgId(null);

      const userMsg: ChatMessage = {
        id: opts?.existingUserMsgId ?? crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      };

      // For a fresh submit append both messages. For a resume, the user
      // message already exists in the list — only append the new assistant.
      if (opts?.existingUserMsgId) {
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
      }
      setIsStreaming(true);
      setStreamingMsgId(assistantMsg.id);
      setAgentSteps([]);

      const historyForApi = opts?.historyOverride
        ? opts.historyOverride
        : opts?.existingUserMsgId
          ? messages // already includes the user message
          : [...messages, userMsg];
      let steps: AgentStep[] = [];

      try {
        const paperPayload = await buildPaperPayload();
        const braveKey = getBraveSearchApiKey();
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: historyForApi.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            model: selectedModel.modelId,
            provider: selectedModel.provider,
            ...(resolveModelCredentials(selectedModel) ?? {
              apiKey: "",
            }),
            ...paperPayload,
            paperTitle,
            arxivId,
            reviewId,
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(braveKey ? { braveSearchApiKey: braveKey } : {}),
            ...(opts?.skipWebSearch ? { skipWebSearch: true } : {}),
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || `Request failed: ${response.status}`);
        }

        if (!response.body) throw new Error("No response body received");

        await parseNDJSONStream(response.body, (event) => {
          if (event.type === "error") {
            // Throw so the catch block handles cleanup uniformly with HTTP errors.
            throw new Error(event.message);
          }
          steps = processStreamEvent(steps, event);
          setAgentSteps([...steps]);
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

        // Persist save_to_knowledge_graph tool calls into IndexedDB
        // client-side (the server tool is now pure validation).
        const graphSaves = steps.filter(
          (s): s is Extract<AgentStep, { kind: "tool_call" }> =>
            s.kind === "tool_call" &&
            s.name === "save_to_knowledge_graph" &&
            !!s.output,
        );
        if (graphSaves.length > 0 && arxivId) {
          for (const step of graphSaves) {
            try {
              await saveRelatedPapersFromAssistant(
                reviewId,
                arxivId,
                paperTitle,
                step.input.papers,
              );
            } catch {
              /* ignore — don't break chat on graph persist failure */
            }
          }
          invalidateExploreCache(reviewId);
        }

        // Ambient: schedule the journal agent to consider this turn.
        // Debounced inside the agent module so a burst of turns collapses
        // into one LLM call.
        if (content && isModelReady(selectedModel)) {
          const creds = resolveModelCredentials(selectedModel);
          if (creds) {
            scheduleJournalAfterChat({
              model: selectedModel,
              apiKey: creds.apiKey,
              apiBaseUrl: creds.apiBaseUrl,
            });
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        // Drop the empty assistant placeholder — never repurpose it for an
        // error, since it visually masquerades as a real reply. The failure
        // is surfaced inline beneath the user message instead.
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
        setError(message);
        setFailedUserMsgId(userMsg.id);
        setLastFailedRequest({ text: trimmed, threadAnnotationId: null });
      } finally {
        setIsStreaming(false);
        setStreamingMsgId(null);
        setAgentSteps([]);
      }
    },
    [
      isStreaming,
      selectedModel,
      messages,
      buildPaperPayload,
      paperTitle,
      arxivId,
      reviewId,
      sourceUrl,
    ],
  );

  /* ---------------------------------------------------------------- */
  /*  Resume after the Brave-key card was actioned                     */
  /* ---------------------------------------------------------------- */

  /**
   * Re-runs the chat agent on the user's last message after the Brave-key
   * configure card has been actioned. Removes the previous (incomplete)
   * assistant message that contained the card, keeps the original user
   * message, and re-submits — passing `skipWebSearch: true` when the user
   * dismissed (so the tool isn't even registered).
   *
   * Called from `BraveKeyResumeProvider` (set up by ChatPanel). No-op when
   * we can't find a user message to retry.
   */
  const resumeAfterBraveDecision = useCallback(
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
      // Truncate trailing messages — keep up through the user message.
      const truncated = messages.slice(0, lastUserIdx + 1);
      setMessages(truncated);

      // Pass the truncated history explicitly so the retry doesn't depend
      // on React state-update timing.
      void submitChat(userMsg.content, {
        existingUserMsgId: userMsg.id,
        historyOverride: truncated,
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
      if (!trimmed || isStreaming || !selectedModel || !chatThreadAnnotationId)
        return;

      if (!isModelReady(selectedModel)) return;

      const ann = await getAnnotation(reviewId, chatThreadAnnotationId);
      if (!ann || ann.kind !== "ask_ai") return;

      setError(null);
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
      setAgentSteps([]);

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
      }));

      let steps: AgentStep[] = [];

      try {
        const paperPayload = await buildPaperPayload();
        const braveKey = getBraveSearchApiKey();
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: historyForApi,
            model: selectedModel.modelId,
            provider: selectedModel.provider,
            ...(resolveModelCredentials(selectedModel) ?? {
              apiKey: "",
            }),
            ...paperPayload,
            paperTitle,
            arxivId,
            reviewId,
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(braveKey ? { braveSearchApiKey: braveKey } : {}),
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || `Request failed: ${response.status}`);
        }

        if (!response.body) throw new Error("No response body received");

        await parseNDJSONStream(response.body, (event) => {
          if (event.type === "error") {
            throw new Error(event.message);
          }
          steps = processStreamEvent(steps, event);
          setAgentSteps([...steps]);
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

        if (content && isModelReady(selectedModel)) {
          const creds = resolveModelCredentials(selectedModel);
          if (creds) {
            scheduleJournalAfterChat({
              model: selectedModel,
              apiKey: creds.apiKey,
              apiBaseUrl: creds.apiBaseUrl,
            });
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        // On error, roll back to the thread with only the user message —
        // don't persist an empty/broken assistant placeholder to the DB.
        thread = threadWithUser;
        await updateAnnotation(reviewId, chatThreadAnnotationId, { thread });
        onAnnotationsPersist();
        setThreadStream(thread);
        setError(message);
        setFailedUserMsgId(userMsg.id);
        setLastFailedRequest({
          text: trimmed,
          threadAnnotationId: chatThreadAnnotationId,
        });
      } finally {
        setIsStreaming(false);
        setStreamingMsgId(null);
        setAgentSteps([]);
        setThreadStream(null);
      }
    },
    [
      isStreaming,
      selectedModel,
      chatThreadAnnotationId,
      reviewId,
      arxivId,
      paperTitle,
      buildPaperPayload,
      onAnnotationsPersist,
      sourceUrl,
    ],
  );

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
    const { text, threadAnnotationId } = lastFailedRequest;
    if (threadAnnotationId) {
      if (chatThreadAnnotationId !== threadAnnotationId) {
        setError("Retry this message from the original selection thread.");
        return;
      }
      await submitThreadChat(text);
      return;
    }
    await submitChat(text);
  }, [
    lastFailedRequest,
    isStreaming,
    chatThreadAnnotationId,
    submitThreadChat,
    submitChat,
  ]);

  return {
    messages,
    input,
    setInput,
    isStreaming,
    error,
    failedUserMsgId,
    agentSteps,
    streamingMsgId,
    hasSavedKeys,
    hasKeyForModel,
    canRetry: !!lastFailedRequest,
    retryLastError,
    clearError: () => {
      setError(null);
      setFailedUserMsgId(null);
      setLastFailedRequest(null);
    },
    sendMessage,
    submitChat,
    submitThreadChat,
    displayThread: threadStream ?? [],
    resumeAfterBraveDecision,
  };
}
