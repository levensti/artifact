"use client";

/**
 * Simplified chat hook for the Knowledge Base page.
 * No annotation threading — just a single chat stream
 * with KB-specific message persistence and chatMode: "kb".
 */

import { useCallback, useEffect, useState } from "react";
import type { Model } from "@/lib/models";
import {
  getApiKey,
  hasAnySavedApiKey,
  isInferenceProviderType,
  isModelReady,
  KEYS_UPDATED_EVENT,
} from "@/lib/keys";
import type { ChatMessage } from "@/lib/review-types";
import { loadKbMessages, saveKbMessages, invalidateKbCache } from "@/lib/client-data";
import type { StreamEvent } from "@/lib/stream-types";
import {
  type AgentStep,
  processStreamEvent,
  stepsToBlocks,
  stepsToContent,
} from "./use-chat";

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
        } catch { /* skip */ }
      }
    }
    if (buffer.trim()) {
      try { onEvent(JSON.parse(buffer.trim()) as StreamEvent); } catch { /* ignore */ }
    }
  } finally {
    reader.releaseLock();
  }
}

interface UseKbChatOptions {
  selectedModel: Model | null;
}

export interface UseKbChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  isStreaming: boolean;
  error: string | null;
  agentSteps: AgentStep[];
  streamingMsgId: string | null;
  hasSavedKeys: boolean;
  hasKeyForModel: boolean;
  clearError: () => void;
  sendMessage: () => Promise<void>;
}

export function useKbChat({
  selectedModel,
}: UseKbChatOptions): UseKbChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keysVersion, setKeysVersion] = useState(0);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);

  // Load KB messages
  useEffect(() => {
    let cancelled = false;
    void loadKbMessages().then((rows) => {
      if (!cancelled) setMessages(rows);
    });
    return () => { cancelled = true; };
  }, []);

  // Listen for API key changes
  useEffect(() => {
    const onKeys = () => setKeysVersion((v) => v + 1);
    window.addEventListener(KEYS_UPDATED_EVENT, onKeys);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, onKeys);
  }, []);

  // Persist messages after streaming
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      void saveKbMessages(messages);
    }
  }, [messages, isStreaming]);

  void keysVersion;

  const hasSavedKeys = hasAnySavedApiKey();
  const hasKeyForModel = selectedModel != null && isModelReady(selectedModel);

  const submitChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || !selectedModel) return;
      if (!isModelReady(selectedModel)) return;

      setError(null);

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
            chatMode: "kb",
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
              ? { ...m, content, blocks: blocks.length > 0 ? blocks : undefined }
              : m,
          ),
        );

        // If the assistant updated the KB, invalidate cache
        const touchedKb = steps.some(
          (s) => s.kind === "tool_call" && s.name === "update_knowledge_base" && s.output,
        );
        if (touchedKb) {
          invalidateKbCache();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: `Error: ${message}` } : m,
          ),
        );
        setError(message);
      } finally {
        setIsStreaming(false);
        setStreamingMsgId(null);
        setAgentSteps([]);
      }
    },
    [isStreaming, selectedModel, messages],
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await submitChat(text);
  }, [input, submitChat]);

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
    clearError: () => setError(null),
    sendMessage,
  };
}
