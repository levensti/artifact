"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, MessageSquare } from "lucide-react";
import { PROVIDER_META, type Model } from "@/lib/models";
import { getApiKey, KEYS_UPDATED_EVENT } from "@/lib/keys";
import { getMessages, saveMessages, type ChatMessage } from "@/lib/reviews";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import ModelSelector from "./model-selector";
import MarkdownMessage from "./markdown-message";
import { useSettingsOpener } from "./settings-opener-context";

interface ChatPanelProps {
  reviewId: string;
  paperContext: string;
  pendingSelection: string | null;
  onSelectionConsumed: () => void;
}

export default function ChatPanel({
  reviewId,
  paperContext,
  pendingSelection,
  onSelectionConsumed,
}: ChatPanelProps) {
  const { openSettings } = useSettingsOpener();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keysVersion, setKeysVersion] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages(getMessages(reviewId));
  }, [reviewId]);

  useEffect(() => {
    const onKeys = () => setKeysVersion((v) => v + 1);
    window.addEventListener(KEYS_UPDATED_EVENT, onKeys);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, onKeys);
  }, []);

  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      saveMessages(reviewId, messages);
    }
  }, [messages, isStreaming, reviewId]);

  void keysVersion;
  const hasKeyForModel =
    selectedModel != null && !!getApiKey(selectedModel.provider);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (pendingSelection) {
      setInput(
        (prev) =>
          (prev ? prev + "\n\n" : "") +
          `> ${pendingSelection}\n\nExplain this passage:`,
      );
      onSelectionConsumed();
      textareaRef.current?.focus();
    }
  }, [pendingSelection, onSelectionConsumed]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming || !selectedModel) return;

    const apiKey = getApiKey(selectedModel.provider);
    if (!apiKey) {
      return;
    }

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
    setInput("");
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          model: selectedModel.modelId,
          provider: selectedModel.provider,
          apiKey,
          paperContext,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Request failed: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body received");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: m.content + chunk }
              : m,
          ),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: `Error: ${message}` }
            : m,
        ),
      );
      setError(message);
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, selectedModel, messages, paperContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const openKeysForChat = () => {
    if (selectedModel) openSettings({ provider: selectedModel.provider });
    else openSettings();
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
        <span className="text-sm font-medium text-muted-foreground">
          Q&amp;A
        </span>
        <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="px-4 py-5 space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-4 px-2">
              <div className="size-11 rounded-xl border border-border bg-muted/40 flex items-center justify-center">
                <MessageSquare
                  className="text-muted-foreground"
                  size={20}
                  strokeWidth={1.75}
                />
              </div>
              <div className="space-y-2 max-w-[260px]">
                <p className="text-sm font-semibold tracking-tight text-foreground">
                  Review thread
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Messages are saved with this paper. Select text in the PDF or
                  type a question below.
                </p>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "max-w-full",
                msg.role === "user" ? "flex justify-end" : "",
              )}
            >
              <div
                className={cn(
                  "rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-secondary text-foreground max-w-[88%] border border-border border-l-[3px] border-l-primary/45 shadow-sm"
                    : "bg-card border border-border/80 text-card-foreground max-w-full shadow-sm",
                )}
              >
                {msg.role === "assistant" && msg.content === "" && isStreaming ? (
                  <div className="flex items-center gap-2 py-0.5 font-sans">
                    <Loader2 className="animate-spin text-muted-foreground" size={14} />
                    <span className="text-sm text-muted-foreground">Generating…</span>
                  </div>
                ) : msg.role === "assistant" ? (
                  <MarkdownMessage content={msg.content} />
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {selectedModel && !hasKeyForModel && (
        <div className="mx-3 mb-2 px-3 py-2.5 rounded-lg border border-border bg-muted/40 text-sm text-foreground leading-snug flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {PROVIDER_META[selectedModel.provider].keyHint} required to send
            messages.
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

      {/* Error */}
      {error && (
        <div className="mx-3 mb-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm leading-snug space-y-2">
          <p>{error}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={openKeysForChat}
          >
            Open API keys
          </Button>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-border shrink-0 bg-muted/20">
        <div className="flex items-end gap-2 bg-card rounded-xl border border-border/90 focus-within:border-primary/25 focus-within:ring-2 focus-within:ring-ring/25 transition-[box-shadow,border-color] duration-200">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the paper"
            rows={1}
            className="flex-1 bg-transparent px-3 py-2.5 text-sm resize-none focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 m-1 text-muted-foreground hover:text-primary"
            onClick={sendMessage}
            disabled={!selectedModel || !input.trim() || isStreaming}
            aria-label={
              !selectedModel
                ? "Select a model to send"
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
        <p className="text-xs text-muted-foreground/70 mt-2 text-center">
          {selectedModel
            ? `${selectedModel.label} · Shift+Enter for new line`
            : "Select a model · Shift+Enter for new line"}
        </p>
      </div>
    </div>
  );
}
