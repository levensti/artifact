"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { PROVIDER_META, type Model } from "@/lib/models";
import { getApiKey, KEYS_UPDATED_EVENT } from "@/lib/keys";
import {
  getMessages,
  saveMessages,
  type ChatAssistantBlock,
  type ChatMessage,
} from "@/lib/reviews";
import { buildLearningContextSummary } from "@/lib/learning-context";
import { stripLearningMapSentinel } from "@/lib/learning-sentinel";
import { runPaperExploreAnalysis } from "@/lib/explore-analysis";
import type { ArxivSearchResult } from "@/lib/explore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import ModelSelector from "./model-selector";
import MarkdownMessage from "./markdown-message";
import { useSettingsOpener } from "./settings-opener-context";
import LearningEmbed from "./learning-embed";

interface ChatPanelProps {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  pendingSelection: string | null;
  onSelectionConsumed: () => void;
  hideHeader?: boolean;
  /** Pre-filled prompt from cross-feature interactions (prerequisites, graph) */
  externalPrompt?: string | null;
  onExternalPromptConsumed?: () => void;
  /** Lifted model state — when provided, ChatPanel uses these instead of internal state */
  selectedModel?: Model | null;
  onModelChange?: (model: Model | null) => void;
}

function ArxivHitsBlock({ query, results }: { query: string; results: ArxivSearchResult[] }) {
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/15 p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        arXiv ({results.length} results) · <span className="text-foreground/80">{query}</span>
      </p>
      <ul className="space-y-2 max-h-[240px] overflow-y-auto">
        {results.slice(0, 12).map((r) => (
          <li key={r.arxivId} className="text-xs border border-border/60 rounded-md p-2 bg-background/80">
            <a
              href={`https://arxiv.org/abs/${r.arxivId}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline leading-snug block"
            >
              {r.title}
            </a>
            <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{r.abstract}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderAssistantBlocks(blocks: ChatAssistantBlock[], ctx: { reviewId: string; arxivId: string; paperTitle: string; paperContext: string; selectedModel: Model | null }) {
  return blocks.map((block, i) => {
    if (block.type === "learning_embed") {
      return (
        <LearningEmbed
          key={`${block.reviewId}-${i}`}
          reviewId={block.reviewId}
          arxivId={ctx.arxivId}
          paperTitle={ctx.paperTitle}
          paperContext={ctx.paperContext}
          selectedModel={ctx.selectedModel}
        />
      );
    }
    return <ArxivHitsBlock key={i} query={block.query} results={block.results} />;
  });
}

export default function ChatPanel({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  pendingSelection,
  onSelectionConsumed,
  hideHeader,
  externalPrompt,
  onExternalPromptConsumed,
  selectedModel: externalModel,
  onModelChange,
}: ChatPanelProps) {
  const { openSettings } = useSettingsOpener();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [internalModel, setInternalModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keysVersion, setKeysVersion] = useState(0);
  const [learningProgress, setLearningProgress] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const learningAbortRef = useRef<AbortController | null>(null);

  // Use lifted model state if provided, otherwise use internal state
  const selectedModel = externalModel !== undefined ? externalModel : internalModel;
  const setSelectedModel = onModelChange ?? setInternalModel;

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

  useLayoutEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const thresholdPx = 120;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist <= thresholdPx) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, learningProgress]);

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

  // Handle external prompt from context zone (prerequisites "Ask about this", graph "Discuss")
  useEffect(() => {
    if (externalPrompt) {
      setInput(externalPrompt);
      onExternalPromptConsumed?.();
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [externalPrompt, onExternalPromptConsumed]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  const submitChat = useCallback(
    async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || learningProgress || !selectedModel) return;

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
    setIsStreaming(true);

    const historyForApi = [...messages, userMsg];
    const learningCtx = buildLearningContextSummary(reviewId);

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
          apiKey,
          paperContext,
          ...(learningCtx ? { learningContext: learningCtx } : {}),
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
      let streamed = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        streamed += chunk;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: m.content + chunk } : m,
          ),
        );
      }

      const { text: withoutSentinel, shouldRunLearningMap } =
        stripLearningMapSentinel(streamed);
      if (withoutSentinel !== streamed) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: withoutSentinel } : m,
          ),
        );
      }

      // When sentinel fires, run analysis and update context zone (no inline embed for new messages)
      if (
        shouldRunLearningMap &&
        paperContext.trim() &&
        selectedModel &&
        hasKeyForModel
      ) {
        const apiKeyRun = getApiKey(selectedModel.provider);
        if (apiKeyRun) {
          learningAbortRef.current?.abort();
          const controller = new AbortController();
          learningAbortRef.current = controller;
          setLearningProgress("Building learning map…");
          try {
            await runPaperExploreAnalysis({
              reviewId,
              arxivId,
              paperTitle,
              paperContext,
              model: selectedModel,
              apiKey: apiKeyRun,
              signal: controller.signal,
              onProgress: setLearningProgress,
            });
            // Instead of inline LearningEmbed, add a simple text message pointing to context zone
            const followup: ChatMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              content:
                "I've updated the **Pre-reading** tab with recommended topics and related papers. You can mark items as read, generate study guides, and ask me about any topic.",
              timestamp: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, followup]);
          } catch (runErr) {
            if (runErr instanceof Error && runErr.name === "AbortError") {
              /* ignore */
            } else {
              const msg =
                runErr instanceof Error
                  ? runErr.message
                  : "Could not build learning map.";
              setError(msg);
            }
          } finally {
            setLearningProgress(null);
          }
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: `Error: ${message}` } : m,
        ),
      );
      setError(message);
    } finally {
      setIsStreaming(false);
    }
  },
    [
      isStreaming,
      learningProgress,
      selectedModel,
      messages,
      paperContext,
      reviewId,
      arxivId,
      paperTitle,
      hasKeyForModel,
    ],
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await submitChat(text);
  }, [input, submitChat]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const openKeysForChat = () => {
    if (selectedModel) openSettings({ provider: selectedModel.provider });
    else openSettings();
  };

  const blockCtx = {
    reviewId,
    arxivId,
    paperTitle,
    paperContext,
    selectedModel,
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {!hideHeader && (
        <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
          <span className="text-sm font-medium text-muted-foreground">
            Assistant
          </span>
          <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
        </div>
      )}
      {hideHeader && (
        <div className="flex items-center justify-end px-3 py-1.5 shrink-0">
          <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
        </div>
      )}

      <div
        ref={scrollAreaRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        <div className="px-4 py-5 space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center gap-3 px-2">
              <div className="size-10 rounded-md border border-border bg-muted/40 flex items-center justify-center">
                <MessageSquare
                  className="text-muted-foreground"
                  size={18}
                  strokeWidth={1.75}
                />
              </div>
              <div className="space-y-1.5 max-w-[min(100%,300px)]">
                <p className="text-sm font-semibold tracking-tight text-foreground">
                  Ask about this paper
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Questions, explanations, or deeper dives — ask anything about the paper.
                </p>
                {!selectedModel ? (
                  <p className="text-[11px] text-muted-foreground/90 pt-1">
                    Select a model to get started.
                  </p>
                ) : !hasKeyForModel ? (
                  <p className="text-[11px] text-muted-foreground/90 pt-1">
                    Add your API key in Settings to send messages.
                  </p>
                ) : null}
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
                  "rounded-md px-3 py-2.5 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-secondary text-foreground max-w-[88%] border border-border border-l-2 border-l-primary/50"
                    : "bg-card border border-border text-card-foreground max-w-full",
                )}
              >
                {msg.role === "assistant" &&
                msg.content === "" &&
                isStreaming ? (
                  <div className="flex items-center gap-2 py-0.5 font-sans">
                    <Loader2
                      className="animate-spin text-muted-foreground"
                      size={14}
                    />
                    <span className="text-sm text-muted-foreground">
                      Generating…
                    </span>
                  </div>
                ) : msg.role === "assistant" ? (
                  <>
                    {msg.content ? (
                      <MarkdownMessage
                        content={stripLearningMapSentinel(msg.content).text}
                      />
                    ) : null}
                    {/* Backward compat: render old learning_embed blocks inline */}
                    {msg.blocks && msg.blocks.length > 0
                      ? renderAssistantBlocks(msg.blocks, blockCtx)
                      : null}
                  </>
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {learningProgress ? (
        <div className="mx-3 mb-1 flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          <Loader2 className="size-3.5 animate-spin shrink-0" />
          <span>{learningProgress}</span>
        </div>
      ) : null}

      {selectedModel && !hasKeyForModel && (
        <div className="mx-3 mb-2 px-3 py-2.5 rounded-md border border-border bg-muted/40 text-sm text-foreground leading-snug flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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

      {error && (
        <div className="mx-3 mb-2 px-3 py-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm leading-snug space-y-2">
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

      <div className="p-3 border-t border-border shrink-0 bg-muted/20">
        <div className="flex items-end gap-2 bg-card rounded-md border border-border focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-ring/40 transition-[box-shadow,border-color] duration-200">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the paper…"
            rows={1}
            className="flex-1 bg-transparent px-3 py-2.5 text-sm resize-none focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 m-1 text-muted-foreground hover:text-primary"
            onClick={sendMessage}
            disabled={
              !selectedModel || !input.trim() || isStreaming || !!learningProgress
            }
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
        <p className="text-xs text-muted-foreground/70 mt-1.5 text-center leading-snug px-1">
          {selectedModel
            ? `${selectedModel.label} · Shift+Enter new line`
            : "Select a model · Shift+Enter new line"}
        </p>
      </div>
    </div>
  );
}
