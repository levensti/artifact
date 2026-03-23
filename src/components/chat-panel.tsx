"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, Trash2, MessageSquare } from "lucide-react";
import { MODELS, type Model } from "@/lib/models";
import { getApiKey } from "@/lib/keys";
import { getMessages, saveMessages, type ChatMessage } from "@/lib/studies";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import ModelSelector from "./model-selector";
import MarkdownMessage from "./markdown-message";

interface ChatPanelProps {
  studyId: string;
  paperContext: string;
  pendingSelection: string | null;
  onSelectionConsumed: () => void;
}

export default function ChatPanel({
  studyId,
  paperContext,
  pendingSelection,
  onSelectionConsumed,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model>(MODELS[0]);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages(getMessages(studyId));
  }, [studyId]);

  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      saveMessages(studyId, messages);
    }
  }, [messages, isStreaming, studyId]);

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
    if (!text || isStreaming) return;

    const apiKey = getApiKey(selectedModel.provider);
    if (!apiKey) {
      const name =
        selectedModel.provider === "anthropic" ? "Anthropic" :
        selectedModel.provider === "openai" ? "OpenAI" : "OpenRouter";
      setError(`No ${name} API key found. Add it in Settings.`);
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

  const clearChat = () => {
    setMessages([]);
    saveMessages(studyId, []);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-12 border-b border-border shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Copilot
        </span>
        <div className="flex items-center gap-1">
          <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={clearChat}
            title="Clear chat"
            aria-label="Clear chat"
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <MessageSquare className="text-primary" size={18} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Ready to help</p>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-[240px]">
                  Ask questions about this paper, or select text in the PDF and
                  click &quot;Ask about this&quot;
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
                  "rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground max-w-[85%]"
                    : "bg-card border border-border text-card-foreground max-w-full",
                )}
              >
                {msg.role === "assistant" && msg.content === "" && isStreaming ? (
                  <div className="flex items-center gap-2 py-0.5">
                    <Loader2 className="animate-spin text-muted-foreground" size={13} />
                    <span className="text-xs text-muted-foreground">Thinking...</span>
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

      {/* Error */}
      {error && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-border shrink-0">
        <div className="flex items-end gap-2 bg-card rounded-lg border border-border focus-within:ring-1 focus-within:ring-ring transition-shadow">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the paper..."
            rows={1}
            className="flex-1 bg-transparent px-3 py-2.5 text-[13px] resize-none focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 m-1 text-muted-foreground hover:text-primary"
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            aria-label={isStreaming ? "Sending..." : "Send message"}
          >
            {isStreaming ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <Send size={15} />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/60 mt-1.5 text-center">
          {selectedModel.label} · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
