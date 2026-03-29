"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Loader2,
  MessageSquareQuote,
  Send,
  Sparkles,
} from "lucide-react";
import { PROVIDER_META, type Model } from "@/lib/models";
import { getApiKey, hasAnySavedApiKey, KEYS_UPDATED_EVENT } from "@/lib/keys";
import {
  getMessages,
  saveMessages,
  type ChatAssistantBlock,
  type ChatMessage,
} from "@/lib/reviews";
import { buildLearningContextSummary } from "@/lib/learning-context";
import { stripLearningMapSentinel } from "@/lib/learning-sentinel";
import { runPaperExploreAnalysis } from "@/lib/explore-analysis";
import { type ArxivSearchResult } from "@/lib/explore";
import type { AnalysisStatus } from "@/hooks/use-auto-analysis";
import type { Annotation, AnnotationMessage } from "@/lib/annotations";
import {
  getAnnotation,
  updateAnnotation,
} from "@/lib/annotations";
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
  /** Live annotation list (for anchored AI threads) */
  annotations: Annotation[];
  /** When set, chat shows this selection’s Q&A thread instead of global paper chat */
  chatThreadAnnotationId: string | null;
  onChatThreadChange: (id: string | null) => void;
  onAnnotationsPersist: () => void;
  hideHeader?: boolean;
  /** Pre-filled prompt from cross-feature interactions (prerequisites, graph) */
  externalPrompt?: string | null;
  onExternalPromptConsumed?: () => void;
  /** Lifted model state — when provided, ChatPanel uses these instead of internal state */
  selectedModel?: Model | null;
  onModelChange?: (model: Model | null) => void;
  /** Analysis state — shown as live progress and preset in the chat */
  analysisStatus?: AnalysisStatus;
  analysisProgress?: string | null;
  analysisError?: string | null;
  canRunAnalysis?: boolean;
  onTriggerAnalysis?: () => boolean;
}

function ArxivHitsBlock({
  query,
  results,
}: {
  query: string;
  results: ArxivSearchResult[];
}) {
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/15 p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        arXiv ({results.length} results) ·{" "}
        <span className="text-foreground/80">{query}</span>
      </p>
      <ul className="space-y-2 max-h-[240px] overflow-y-auto">
        {results.slice(0, 12).map((r) => (
          <li
            key={r.arxivId}
            className="text-xs border border-border/60 rounded-md p-2 bg-background/80"
          >
            <a
              href={`https://arxiv.org/abs/${r.arxivId}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline leading-snug block"
            >
              {r.title}
            </a>
            <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
              {r.abstract}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderAssistantBlocks(
  blocks: ChatAssistantBlock[],
  ctx: {
    reviewId: string;
    arxivId: string;
    paperTitle: string;
    paperContext: string;
    selectedModel: Model | null;
  },
) {
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
    return (
      <ArxivHitsBlock key={i} query={block.query} results={block.results} />
    );
  });
}

export default function ChatPanel({
  reviewId,
  arxivId,
  paperTitle,
  paperContext,
  annotations,
  chatThreadAnnotationId,
  onChatThreadChange,
  onAnnotationsPersist,
  hideHeader,
  externalPrompt,
  onExternalPromptConsumed,
  selectedModel: externalModel,
  onModelChange,
  analysisStatus,
  analysisProgress,
  analysisError,
  canRunAnalysis,
  onTriggerAnalysis,
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
  /** After passage-thread send / external prompt: scroll messages to bottom once input layout has settled */
  const scrollComposerIntoViewRef = useRef(false);

  // Use lifted model state if provided, otherwise use internal state
  const selectedModel =
    externalModel !== undefined ? externalModel : internalModel;
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

  const [threadStream, setThreadStream] = useState<AnnotationMessage[] | null>(
    null,
  );

  const activeThreadAnn = useMemo(() => {
    if (!chatThreadAnnotationId) return undefined;
    return annotations.find(
      (a) => a.id === chatThreadAnnotationId && a.kind === "ask_ai",
    );
  }, [annotations, chatThreadAnnotationId]);

  const displayThread = useMemo(
    () => threadStream ?? activeThreadAnn?.thread ?? [],
    [threadStream, activeThreadAnn?.thread],
  );

  const hasSavedKeys = hasAnySavedApiKey();
  const hasKeyForModel =
    selectedModel != null && !!getApiKey(selectedModel.provider);

  // Inject rich inline results when externally-triggered analysis completes
  const prevAnalysisStatus = useRef(analysisStatus);
  const prevReviewIdRef = useRef(reviewId);
  useEffect(() => {
    // Reset ref on review switch to avoid spurious injection
    if (prevReviewIdRef.current !== reviewId) {
      prevAnalysisStatus.current = analysisStatus;
      prevReviewIdRef.current = reviewId;
      return;
    }
    if (prevAnalysisStatus.current === "running" && analysisStatus === "done") {
      const resultMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        blocks: [{ type: "learning_embed", reviewId }],
      };
      setMessages((prev) => [...prev, resultMsg]);
    }
    prevAnalysisStatus.current = analysisStatus;
  }, [analysisStatus, reviewId]);

  // External analysis is running (not the sentinel-triggered one)
  const externalAnalysisRunning =
    analysisStatus === "running" && !learningProgress;

  useLayoutEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const thresholdPx = 120;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist <= thresholdPx) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, learningProgress, analysisProgress, displayThread]);

  useEffect(() => {
    if (chatThreadAnnotationId && !activeThreadAnn) {
      onChatThreadChange(null);
    }
  }, [chatThreadAnnotationId, activeThreadAnn, onChatThreadChange]);

  useEffect(() => {
    setThreadStream(null);
  }, [chatThreadAnnotationId]);

  useEffect(() => {
    if (!chatThreadAnnotationId) return;
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [chatThreadAnnotationId]);

  // Handle external prompt from context zone (prerequisites "Ask about this", graph "Discuss")
  useEffect(() => {
    if (!externalPrompt) return;
    scrollComposerIntoViewRef.current = true;
    setInput(externalPrompt);
    onExternalPromptConsumed?.();
    const safety = window.setTimeout(() => {
      scrollComposerIntoViewRef.current = false;
    }, 600);
    return () => clearTimeout(safety);
  }, [externalPrompt, onExternalPromptConsumed]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;

    if (!scrollComposerIntoViewRef.current) return;
    scrollComposerIntoViewRef.current = false;

    const scrollMessagesToBottom = () => {
      const el = scrollAreaRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    scrollMessagesToBottom();
    requestAnimationFrame(() => {
      scrollMessagesToBottom();
      textareaRef.current?.focus({ preventScroll: true });
      requestAnimationFrame(scrollMessagesToBottom);
    });
    setTimeout(scrollMessagesToBottom, 0);
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
          const snapshot = streamed;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: snapshot } : m,
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
              const followup: ChatMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
                blocks: [{ type: "learning_embed", reviewId }],
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
            m.id === assistantMsg.id
              ? { ...m, content: `Error: ${message}` }
              : m,
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

  const submitThreadChat = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (
        !trimmed ||
        isStreaming ||
        learningProgress ||
        !selectedModel ||
        !chatThreadAnnotationId
      ) {
        return;
      }

      const apiKey = getApiKey(selectedModel.provider);
      if (!apiKey) return;

      const ann = getAnnotation(reviewId, chatThreadAnnotationId);
      if (!ann || ann.kind !== "ask_ai") return;

      setError(null);
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

      let thread: AnnotationMessage[] = [...ann.thread, userMsg, assistantMsg];
      setThreadStream(thread);
      updateAnnotation(reviewId, chatThreadAnnotationId, { thread });
      onAnnotationsPersist();

      setIsStreaming(true);

      const historyForApi = [...ann.thread, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const learningCtx = buildLearningContextSummary(reviewId);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: historyForApi,
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
          thread = thread.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: streamed } : m,
          );
          setThreadStream(thread);
        }

        const { text: withoutSentinel, shouldRunLearningMap } =
          stripLearningMapSentinel(streamed);
        if (withoutSentinel !== streamed) {
          thread = thread.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: withoutSentinel } : m,
          );
          setThreadStream(thread);
        }

        updateAnnotation(reviewId, chatThreadAnnotationId, { thread });
        onAnnotationsPersist();

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
              const followup: AnnotationMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: "",
                timestamp: new Date().toISOString(),
                blocks: [{ type: "learning_embed", reviewId }],
              };
              thread = [...thread, followup];
              updateAnnotation(reviewId, chatThreadAnnotationId, { thread });
              onAnnotationsPersist();
              setThreadStream(thread);
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
        thread = thread.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: `Error: ${message}` } : m,
        );
        updateAnnotation(reviewId, chatThreadAnnotationId, { thread });
        onAnnotationsPersist();
        setThreadStream(thread);
        setError(message);
      } finally {
        setIsStreaming(false);
        setThreadStream(null);
      }
    },
    [
      isStreaming,
      learningProgress,
      selectedModel,
      chatThreadAnnotationId,
      reviewId,
      arxivId,
      paperTitle,
      paperContext,
      hasKeyForModel,
      onAnnotationsPersist,
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

      <div
        ref={scrollAreaRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        <div className="px-4 py-5 space-y-5">
          {chatThreadAnnotationId && activeThreadAnn ? (
            <>
              <div className="flex flex-col gap-2 border-b border-border/80 pb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Selection thread
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-9 w-full shrink-0 gap-2 px-3 text-xs font-medium shadow-sm sm:h-8 sm:w-auto"
                  onClick={() => onChatThreadChange(null)}
                  aria-label="Back to whole-paper assistant chat"
                >
                  <ArrowLeft className="size-3.5 shrink-0" strokeWidth={2.5} />
                  Back to paper chat
                </Button>
              </div>

              <div className="rounded-lg border border-sky-500/25 bg-sky-500/6 px-3 py-2.5">
                <div className="flex gap-2">
                  <MessageSquareQuote
                    className="mt-0.5 size-4 shrink-0 text-sky-600/90"
                    strokeWidth={2}
                  />
                  <p className="text-xs italic leading-snug text-muted-foreground">
                    &ldquo;{activeThreadAnn.highlightText}&rdquo;
                  </p>
                </div>
              </div>

              {displayThread.length === 0 && (
                <div className="space-y-2 py-6 text-center px-1">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Ask a question about this passage below. Replies stay in
                    this thread only.
                  </p>
                  <div className="text-xs text-muted-foreground/85 leading-relaxed">
                    Whole-paper starters and general Q&amp;A live in{" "}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium text-foreground/90 underline-offset-2 hover:underline"
                      onClick={() => onChatThreadChange(null)}
                    >
                      <ArrowLeft className="size-3" strokeWidth={2.5} />
                      paper chat
                    </button>
                    .
                  </div>
                </div>
              )}

              {displayThread.map((msg) => {
                const hasBlocks = msg.blocks && msg.blocks.length > 0;
                const blockOnly = hasBlocks && !msg.content;

                return (
                  <div
                    key={msg.id}
                    className={cn(
                      "max-w-full",
                      msg.role === "user" ? "flex justify-end" : "",
                    )}
                  >
                    {msg.role === "assistant" && blockOnly && !isStreaming ? (
                      <div className="max-w-full">
                        {renderAssistantBlocks(msg.blocks!, blockCtx)}
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "rounded-md px-3 py-2.5 text-sm leading-relaxed",
                          msg.role === "user"
                            ? "max-w-[88%] border border-border border-l-2 border-l-sky-500/45 bg-secondary text-foreground"
                            : "max-w-full border border-border bg-card text-card-foreground",
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
                                content={
                                  stripLearningMapSentinel(msg.content).text
                                }
                              />
                            ) : null}
                            {hasBlocks
                              ? renderAssistantBlocks(msg.blocks!, blockCtx)
                              : null}
                          </>
                        ) : (
                          <div className="whitespace-pre-wrap">
                            {msg.content}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {externalAnalysisRunning && (
                <AnalysisProgressCard progress={analysisProgress ?? null} />
              )}
              {learningProgress && !externalAnalysisRunning && (
                <AnalysisProgressCard progress={learningProgress} />
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border/80 pb-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Paper chat
                </span>
                <span className="text-[10px] font-medium text-muted-foreground/80">
                  Whole paper
                </span>
              </div>

              {messages.length === 0 && (
                <div className="flex min-h-[120px] h-full flex-col items-center justify-center gap-2 px-4 text-center">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Messages here apply to the full document—not a single
                    highlight. Use{" "}
                    <span className="font-medium text-foreground/85">
                      Dive deeper
                    </span>{" "}
                    on a selection to open a thread tied to that passage.
                  </p>
                  <p className="text-xs text-muted-foreground/90 leading-relaxed max-w-[280px]">
                    Starters below (prerequisites, related papers) run in this
                    chat only.
                  </p>
                </div>
              )}

              {messages.map((msg) => {
                const hasBlocks = msg.blocks && msg.blocks.length > 0;
                const blockOnly = hasBlocks && !msg.content;

                return (
                  <div
                    key={msg.id}
                    className={cn(
                      "max-w-full",
                      msg.role === "user" ? "flex justify-end" : "",
                    )}
                  >
                    {msg.role === "assistant" && blockOnly && !isStreaming ? (
                      <div className="max-w-full">
                        {renderAssistantBlocks(msg.blocks!, blockCtx)}
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "rounded-md px-3 py-2.5 text-sm leading-relaxed",
                          msg.role === "user"
                            ? "max-w-[88%] border border-border border-l-2 border-l-primary/50 bg-secondary text-foreground"
                            : "max-w-full border border-border bg-card text-card-foreground",
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
                                content={
                                  stripLearningMapSentinel(msg.content).text
                                }
                              />
                            ) : null}
                            {hasBlocks
                              ? renderAssistantBlocks(msg.blocks!, blockCtx)
                              : null}
                          </>
                        ) : (
                          <div className="whitespace-pre-wrap">
                            {msg.content}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {externalAnalysisRunning && (
                <AnalysisProgressCard progress={analysisProgress ?? null} />
              )}

              {learningProgress && !externalAnalysisRunning && (
                <AnalysisProgressCard progress={learningProgress} />
              )}
            </>
          )}
        </div>
      </div>

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
            Manage API keys
          </Button>
        </div>
      )}

      {/* Whole-paper suggestion chips — main chat only; not for selection threads */}
      {analysisStatus === "idle" && !chatThreadAnnotationId && (
        <div className="shrink-0 border-t border-border/50 px-3 pt-3 pb-2">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Whole-paper starters
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {[
            {
              label: "Prerequisites",
              message:
                "What concepts and background should I understand before reading this paper?",
            },
            {
              label: "Related papers",
              message:
                "Find related papers and map the research landscape around this work.",
            },
          ].map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={
                !selectedModel ||
                !hasKeyForModel ||
                isStreaming ||
                !!learningProgress
              }
              onClick={() => void submitChat(chip.message)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                selectedModel && hasKeyForModel
                  ? "border-border bg-card hover:bg-accent text-foreground cursor-pointer"
                  : "border-border/50 bg-muted/30 text-muted-foreground cursor-not-allowed",
              )}
            >
              <Sparkles className="size-3" />
              {chip.label}
            </button>
            ))}
          </div>
        </div>
      )}

      {analysisStatus === "error" && onTriggerAnalysis && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-md border border-destructive/20 bg-destructive/4 shrink-0 flex items-center justify-between gap-2">
          <p className="text-xs text-destructive/90 truncate">
            {analysisError ?? "Analysis failed"}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-destructive hover:text-destructive shrink-0"
            onClick={onTriggerAnalysis}
            disabled={!canRunAnalysis}
          >
            Retry
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
            placeholder={
              chatThreadAnnotationId
                ? "Reply in this selection thread…"
                : "Ask about the paper…"
            }
            rows={1}
            className="flex-1 bg-transparent px-3 py-2.5 text-sm resize-none focus:outline-none text-foreground placeholder:text-muted-foreground"
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 m-1 text-muted-foreground hover:text-primary"
            onClick={sendMessage}
            disabled={
              !selectedModel ||
              !input.trim() ||
              isStreaming ||
              !!learningProgress
            }
            aria-label={
              !selectedModel
                ? hasSavedKeys
                  ? "Choose a model to send"
                  : "Manage API keys to send"
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
        <div className="mt-2 space-y-1.5">
          <p className="px-1 text-center text-[11px] leading-snug text-muted-foreground/85">
            {chatThreadAnnotationId
              ? "Replies stay tied to this highlight."
              : "Messages apply to the whole paper, not one selection."}
          </p>
          <p className="px-1 text-center text-xs leading-snug text-muted-foreground/70">
            {chatThreadAnnotationId
              ? selectedModel
                ? `${selectedModel.label} · Shift+Enter new line`
                : "Choose a model above · Shift+Enter new line"
              : selectedModel
                ? `${selectedModel.label} · Shift+Enter new line`
                : hasSavedKeys
                  ? "Choose a model above · Shift+Enter new line"
                  : "Manage API keys first · Shift+Enter new line"}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Analysis progress card (shown in chat during analysis)             */
/* ------------------------------------------------------------------ */

function AnalysisProgressCard({ progress }: { progress: string | null }) {
  return (
    <div className="max-w-full" style={{ animation: "fadeIn 200ms ease-out" }}>
      <div className="rounded-md px-3 py-2.5 text-sm leading-relaxed bg-card border border-border text-card-foreground max-w-full">
        <div className="flex items-start gap-2.5">
          <div className="size-6 rounded-md bg-primary/8 border border-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="size-3 text-primary" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-xs font-medium text-foreground">
              Analyzing paper
            </p>
            <div className="flex items-center gap-2">
              <span className="inline-flex gap-[3px]">
                <span
                  className="size-[5px] rounded-full bg-primary/60 animate-bounce"
                  style={{ animationDelay: "0ms", animationDuration: "1.2s" }}
                />
                <span
                  className="size-[5px] rounded-full bg-primary/60 animate-bounce"
                  style={{ animationDelay: "150ms", animationDuration: "1.2s" }}
                />
                <span
                  className="size-[5px] rounded-full bg-primary/60 animate-bounce"
                  style={{ animationDelay: "300ms", animationDuration: "1.2s" }}
                />
              </span>
              <p className="text-xs text-muted-foreground truncate">
                {progress ?? "Starting analysis\u2026"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
