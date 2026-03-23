"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, Trash2, Sparkles } from "lucide-react";
import { MODELS, type Model } from "@/lib/models";
import { getApiKey } from "@/lib/keys";
import { cn } from "@/lib/utils";
import ModelSelector from "./model-selector";
import MarkdownMessage from "./markdown-message";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  paperContext: string;
  pendingSelection: string | null;
  onSelectionConsumed: () => void;
  onOpenSettings: () => void;
}

export default function ChatPanel({
  paperContext,
  pendingSelection,
  onSelectionConsumed,
  onOpenSettings,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model>(MODELS[0]);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Handle incoming selection from PDF
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

  // Auto-resize textarea
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
      setError(`Please add your ${selectedModel.provider === "anthropic" ? "Anthropic" : "OpenAI"} API key in Settings.`);
      return;
    }

    setError(null);
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
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

  return (
    <div className="flex flex-col h-full bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-accent" />
          <span className="text-sm font-medium">Paper Copilot</span>
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector
            selected={selectedModel}
            onSelect={setSelectedModel}
          />
          <button
            onClick={() => setMessages([])}
            className="p-1.5 rounded-md hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
            title="Clear chat"
            aria-label="Clear chat"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-accent-muted flex items-center justify-center">
              <Sparkles className="text-accent" size={24} />
            </div>
            <div>
              <p className="text-text-primary font-medium">Ready to help</p>
              <p className="text-text-muted text-sm mt-1 max-w-[280px]">
                Ask questions about the paper, or select text in the PDF and
                click &quot;Ask about this&quot;
              </p>
            </div>
            {!getApiKey("anthropic") && !getApiKey("openai") && (
              <button
                onClick={onOpenSettings}
                className="mt-2 text-sm text-accent hover:text-accent-hover transition-colors"
              >
                Add your API key to get started
              </button>
            )}
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
                "rounded-xl px-4 py-3 text-sm leading-relaxed",
                msg.role === "user"
                  ? "bg-accent text-white max-w-[85%]"
                  : "bg-bg-tertiary text-text-primary max-w-full",
              )}
            >
              {msg.role === "assistant" && msg.content === "" && isStreaming ? (
                <Loader2 className="animate-spin text-text-muted" size={16} />
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

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-border shrink-0">
        <div className="flex items-end gap-2 bg-bg-tertiary rounded-xl border border-border-light focus-within:border-accent transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the paper... (Shift+Enter for new line)"
            rows={1}
            className="flex-1 bg-transparent px-4 py-3 text-sm resize-none focus:outline-none text-text-primary placeholder:text-text-muted"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className="p-3 text-text-muted hover:text-accent disabled:opacity-30 transition-colors"
          >
            {isStreaming ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
        <p className="text-[11px] text-text-muted mt-2 text-center">
          Using {selectedModel.label} · Keys stored in your browser
        </p>
      </div>
    </div>
  );
}
