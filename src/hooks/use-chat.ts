"use client";

import { useCallback, useEffect, useState } from "react";
import type { Model } from "@/lib/models";
import {
  getApiKey,
  hasAnySavedApiKey,
  isInferenceProviderType,
  isModelReady,
  KEYS_UPDATED_EVENT,
} from "@/lib/keys";
import {
  loadMessages,
  saveMessages,
  type ChatAssistantBlock,
  type ChatMessage,
} from "@/lib/reviews";
import { invalidateExploreCache, invalidateKbCache } from "@/lib/client-data";
import type { AnnotationMessage } from "@/lib/annotations";
import { getAnnotation, updateAnnotation } from "@/lib/annotations";
import type { StreamEvent } from "@/lib/stream-types";

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
        try {
          onEvent(JSON.parse(trimmed) as StreamEvent);
        } catch {
          // skip malformed lines
        }
      }
    }
    if (buffer.trim()) {
      try {
        onEvent(JSON.parse(buffer.trim()) as StreamEvent);
      } catch {
        /* ignore */
      }
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
  const hasKeyForModel =
    selectedModel != null && isModelReady(selectedModel);

  /* ---------------------------------------------------------------- */
  /*  Main chat submit                                                 */
  /* ---------------------------------------------------------------- */

  const submitChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || !selectedModel) return;

      if (!isModelReady(selectedModel)) return;

      setError(null);
      setLastFailedRequest(null);

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
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

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      setStreamingMsgId(assistantMsg.id);
      setAgentSteps([]);

      const historyForApi = [...messages, userMsg];
      let steps: AgentStep[] = [];

      try {
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
            ...(isInferenceProviderType(selectedModel.provider)
              ? { profileId: selectedModel.profileId }
              : { apiKey: getApiKey(selectedModel.provider)! }),
            paperContext,
            paperTitle,
            arxivId,
            reviewId,
            ...(sourceUrl ? { sourceUrl } : {}),
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || `Request failed: ${response.status}`);
        }

        if (!response.body) throw new Error("No response body received");

        await parseNDJSONStream(response.body, (event) => {
          if (event.type === "error") {
            setError(event.message);
            return;
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

        // If the assistant saved to the knowledge graph, invalidate cache
        // so the Discovery tab picks up the new data.
        const touchedGraph = steps.some(
          (s) =>
            s.kind === "tool_call" &&
            s.name === "save_to_knowledge_graph" &&
            s.output,
        );
        if (touchedGraph) {
          invalidateExploreCache(reviewId);
        }

        // If the assistant updated the KB, invalidate cache
        const touchedKb = steps.some(
          (s) =>
            s.kind === "tool_call" &&
            s.name === "update_knowledge_base" &&
            s.output,
        );
        if (touchedKb) {
          invalidateKbCache();
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `Error: ${message}` }
              : m,
          ),
        );
        setError(message);
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
      paperContext,
      paperTitle,
      arxivId,
      reviewId,
      sourceUrl,
    ],
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
        content: i === 0 && m.role === "user" ? highlightPreamble + m.content : m.content,
      }));

      let steps: AgentStep[] = [];

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: historyForApi,
            model: selectedModel.modelId,
            provider: selectedModel.provider,
            ...(isInferenceProviderType(selectedModel.provider)
              ? { profileId: selectedModel.profileId }
              : { apiKey: getApiKey(selectedModel.provider)! }),
            paperContext,
            paperTitle,
            arxivId,
            reviewId,
            ...(sourceUrl ? { sourceUrl } : {}),
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || `Request failed: ${response.status}`);
        }

        if (!response.body) throw new Error("No response body received");

        await parseNDJSONStream(response.body, (event) => {
          if (event.type === "error") {
            setError(event.message);
            return;
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
      paperContext,
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
    agentSteps,
    streamingMsgId,
    hasSavedKeys,
    hasKeyForModel,
    canRetry: !!lastFailedRequest,
    retryLastError,
    clearError: () => setError(null),
    sendMessage,
    submitChat,
    submitThreadChat,
    displayThread: threadStream ?? [],
  };
}
