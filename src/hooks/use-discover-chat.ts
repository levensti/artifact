"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Model } from "@/lib/models";
import {
  getBraveSearchApiKey,
  isModelReady,
  resolveModelCredentials,
} from "@/lib/keys";
import type { StreamEvent } from "@/lib/stream-types";
import {
  processStreamEvent,
  type AgentStep,
} from "@/hooks/use-chat";

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "artifact-discover-thread-v1";

export interface DiscoverMessage {
  id: string;
  role: "user" | "assistant";
  ts: string;
  /** User messages: plain text. */
  content?: string;
  /** Assistant messages: serialized agent steps from the streamed turn. */
  steps?: AgentStep[];
}

function loadThread(): DiscoverMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DiscoverMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveThread(messages: DiscoverMessage[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    /* quota exceeded — best-effort only */
  }
}

/* ------------------------------------------------------------------ */
/*  NDJSON parser (mirrors use-chat.ts)                                */
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
      buffer = lines.pop() ?? "";
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

interface UseDiscoverChatOptions {
  selectedModel: Model | null;
}

export interface UseDiscoverChatReturn {
  messages: DiscoverMessage[];
  input: string;
  setInput: (v: string) => void;
  isStreaming: boolean;
  error: string | null;
  liveSteps: AgentStep[];
  /** Stable id of the assistant message currently being streamed (so the UI can render liveSteps in place). */
  streamingMsgId: string | null;
  hasKeyForModel: boolean;
  sendMessage: () => Promise<void>;
  submit: (text: string) => Promise<void>;
  clearThread: () => void;
}

export function useDiscoverChat({
  selectedModel,
}: UseDiscoverChatOptions): UseDiscoverChatReturn {
  const [messages, setMessages] = useState<DiscoverMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);

  // Hydrate from sessionStorage after mount (avoids SSR/client mismatch).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const restored = loadThread();
    if (restored.length > 0) setMessages(restored);
  }, []);

  // Persist after every change once we've hydrated.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveThread(messages);
  }, [messages]);

  const hasKeyForModel = selectedModel != null && isModelReady(selectedModel);

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || !selectedModel) return;
      if (!isModelReady(selectedModel)) return;

      setError(null);

      const userMsg: DiscoverMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        ts: new Date().toISOString(),
      };
      const assistantMsg: DiscoverMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        steps: [],
        ts: new Date().toISOString(),
      };

      const baseHistory = [...messages, userMsg];
      setMessages([...baseHistory, assistantMsg]);
      setIsStreaming(true);
      setStreamingMsgId(assistantMsg.id);
      setLiveSteps([]);

      // Send only the textual content of prior turns to the model — the
      // server treats the discovery transcript like any other chat history.
      const apiHistory = baseHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content:
          m.role === "user"
            ? (m.content ?? "")
            : (m.steps ?? [])
                .filter(
                  (s): s is Extract<AgentStep, { kind: "text" }> =>
                    s.kind === "text",
                )
                .map((s) => s.text)
                .join(""),
      }));

      let steps: AgentStep[] = [];

      try {
        const creds = resolveModelCredentials(selectedModel) ?? { apiKey: "" };
        const braveKey = getBraveSearchApiKey();
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiHistory,
            model: selectedModel.modelId,
            provider: selectedModel.provider,
            ...creds,
            mode: "discover",
            ...(braveKey ? { braveSearchApiKey: braveKey } : {}),
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string })?.error ??
              `Request failed: ${response.status}`,
          );
        }
        if (!response.body) throw new Error("No response body received");

        await parseNDJSONStream(response.body, (event) => {
          if (event.type === "error") throw new Error(event.message);
          steps = processStreamEvent(steps, event);
          setLiveSteps([...steps]);
        });

        // Strip trailing "thinking" sentinel (no completed text/tool yet) so
        // it doesn't get persisted as a permanent ghost step.
        const finalSteps = steps.filter((s) => s.kind !== "thinking");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, steps: finalSteps } : m,
          ),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        // Drop the empty assistant placeholder rather than leaving a hollow
        // bubble. The error is surfaced inline in the panel header.
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
        setError(message);
      } finally {
        setIsStreaming(false);
        setStreamingMsgId(null);
        setLiveSteps([]);
      }
    },
    [isStreaming, selectedModel, messages],
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await submit(text);
  }, [input, submit]);

  const clearThread = useCallback(() => {
    setMessages([]);
    setError(null);
    setLiveSteps([]);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  return {
    messages,
    input,
    setInput,
    isStreaming,
    error,
    liveSteps,
    streamingMsgId,
    hasKeyForModel,
    sendMessage,
    submit,
    clearThread,
  };
}
