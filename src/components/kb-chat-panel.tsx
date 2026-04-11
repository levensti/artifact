"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Loader2,
  Send,
  Sparkles,
} from "lucide-react";
import type { Model } from "@/lib/models";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import ModelSelector from "./model-selector";
import { useSettingsOpener } from "./settings-opener-context";
import { ChatMessageBubble, type BlockCtx } from "./chat-message-bubble";
import { useKbChat } from "@/hooks/use-kb-chat";

interface KbChatPanelProps {
  selectedModel: Model | null;
  onModelChange: (model: Model | null) => void;
}

export default function KbChatPanel({
  selectedModel,
  onModelChange,
}: KbChatPanelProps) {
  const { openSettings } = useSettingsOpener();
  const chat = useKbChat({ selectedModel });
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new content
  useLayoutEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const thresholdPx = 120;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist <= thresholdPx) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chat.messages, chat.agentSteps]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [chat.input]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void chat.sendMessage();
      }
    },
    [chat],
  );

  const inputLocked = !chat.hasSavedKeys;

  const blockCtx: BlockCtx = {
    reviewId: "",
    arxivId: "",
    paperTitle: "",
    paperContext: "",
    selectedModel,
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-background to-primary/[0.03] px-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="size-3.5 shrink-0 text-primary" strokeWidth={2} />
          <span className="text-xs font-bold tracking-tight text-foreground truncate">
            KB Assistant
          </span>
        </div>
        <ModelSelector selected={selectedModel} onSelect={onModelChange} />
      </header>

      {/* Messages */}
      <div
        ref={scrollAreaRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        <div className="space-y-5 px-4 pb-5 pt-5">
          {chat.messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
              <div className="size-12 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-center">
                <BookOpen className="size-5 text-primary" strokeWidth={1.5} />
              </div>
              <div className="space-y-1.5 max-w-xs">
                <p className="text-sm font-semibold text-foreground">
                  Knowledge Base Assistant
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Ask about your compiled knowledge, find connections across
                  papers, create new pages, or check for gaps.
                </p>
              </div>
            </div>
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
            />
          ))}
        </div>
      </div>

      {/* Error */}
      {chat.error && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-snug">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <p>{chat.error}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-1.5 h-7 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={chat.clearError}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Input */}
      <div className="p-3 shrink-0">
        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border transition-[box-shadow,border-color,background-color] duration-200",
            inputLocked
              ? "border-amber-500/35 bg-amber-500/5"
              : "bg-card border-border shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/20",
          )}
        >
          <textarea
            ref={textareaRef}
            value={chat.input}
            onChange={(e) => chat.setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={inputLocked}
            placeholder={
              inputLocked
                ? "Add an API key to start chatting…"
                : "Ask about your knowledge base…"
            }
            rows={1}
            className={cn(
              "flex-1 bg-transparent px-3 py-2.5 text-sm resize-none text-foreground placeholder:text-muted-foreground",
              inputLocked ? "cursor-not-allowed opacity-75" : "focus:outline-none",
            )}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 m-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
            onClick={chat.sendMessage}
            disabled={inputLocked || !selectedModel || !chat.input.trim() || chat.isStreaming}
            aria-label="Send message"
          >
            {chat.isStreaming ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <Send size={15} />
            )}
          </Button>
        </div>
        {inputLocked && (
          <div className="mt-1.5 flex justify-center">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={() => openSettings()}
            >
              Add API key to unlock chat
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
