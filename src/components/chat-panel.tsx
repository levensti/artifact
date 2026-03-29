"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  MessageSquareQuote,
  Network,
  Search,
  Send,
  Wrench,
} from "lucide-react";
import { PROVIDER_META, type Model } from "@/lib/models";
import type { ArxivSearchResult } from "@/lib/explore";
import type { ChatAssistantBlock, ChatMessage } from "@/lib/review-types";
import type { Annotation, AnnotationMessage } from "@/lib/annotations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import ModelSelector from "./model-selector";
import MarkdownMessage from "./markdown-message";
import { useSettingsOpener } from "./settings-opener-context";
import LearningEmbed from "./learning-embed";
import { useChat, type AgentStep } from "@/hooks/use-chat";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ChatPanelProps {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  annotations: Annotation[];
  chatThreadAnnotationId: string | null;
  onChatThreadChange: (id: string | null) => void;
  onAnnotationsPersist: () => void;
  hideHeader?: boolean;
  externalPrompt?: string | null;
  onExternalPromptConsumed?: () => void;
  selectedModel?: Model | null;
  onModelChange?: (model: Model | null) => void;
}

/* ------------------------------------------------------------------ */
/*  Tool display helpers                                               */
/* ------------------------------------------------------------------ */

const TOOL_LABELS: Record<string, [string, string]> = {
  arxiv_search: ["Searching arXiv", "Searched arXiv"],
  web_search: ["Searching the web", "Searched the web"],
  rank_results: ["Ranking results", "Ranked results"],
};

function toolLabel(name: string, done: boolean): string {
  const entry = TOOL_LABELS[name];
  if (entry) return done ? entry[1] : entry[0];
  return done ? `Ran ${name}` : `Running ${name}`;
}

const TOOL_ICONS: Record<string, typeof Search> = {
  arxiv_search: Search,
  web_search: Search,
  rank_results: Wrench,
};

/* ------------------------------------------------------------------ */
/*  Step renderers                                                     */
/* ------------------------------------------------------------------ */

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <BrainCircuit className="size-3.5 text-primary/60 animate-pulse shrink-0" />
      <span className="text-xs text-muted-foreground font-medium">Thinking…</span>
      <span className="inline-flex gap-[3px]">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-[4px] rounded-full bg-primary/40 animate-bounce"
            style={{ animationDelay: `${delay}ms`, animationDuration: "1.2s" }}
          />
        ))}
      </span>
    </div>
  );
}

function ToolCallStep({
  name,
  input,
  output,
  isLive,
}: {
  name: string;
  input: Record<string, unknown>;
  output?: string;
  isLive?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[name] ?? Wrench;
  const done = !!output;
  const queryStr = "query" in input && input.query ? String(input.query) : null;

  return (
    <div
      className="my-1.5 rounded-md border border-border/70 bg-muted/15 text-xs overflow-hidden"
      style={isLive ? { animation: "fadeIn 200ms ease-out" } : undefined}
    >
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors",
          done && "hover:bg-muted/30 cursor-pointer",
          !done && "cursor-default",
        )}
        onClick={() => done && setOpen(!open)}
        disabled={!done}
      >
        {done ? (
          <Check className="size-3 text-emerald-600 shrink-0" strokeWidth={2.5} />
        ) : (
          <Loader2 className="size-3 text-primary/60 animate-spin shrink-0" />
        )}
        <Icon className="size-3 text-muted-foreground/70 shrink-0" />
        <span className="font-medium text-foreground/80">
          {toolLabel(name, done)}
        </span>
        {queryStr && (
          <span className="text-muted-foreground/70 truncate max-w-[180px]">
            &middot; {queryStr}
          </span>
        )}
        {done && (
          <span className="ml-auto text-muted-foreground/50">
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </span>
        )}
      </button>
      {open && output && (
        <div className="border-t border-border/40 px-2.5 py-2 max-h-[180px] overflow-y-auto bg-muted/5">
          <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground/80 leading-relaxed">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Interleaved blocks renderer (for persisted messages)               */
/* ------------------------------------------------------------------ */

interface BlockCtx {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  selectedModel: Model | null;
}

function hasInterleavedBlocks(blocks: ChatAssistantBlock[]): boolean {
  return blocks.some((b) => b.type === "text_segment" || b.type === "tool_call");
}

function renderInterleavedBlocks(blocks: ChatAssistantBlock[], ctx: BlockCtx) {
  return blocks.map((block, i) => {
    if (block.type === "text_segment") {
      return block.content ? (
        <MarkdownMessage key={`ts-${i}`} content={block.content} />
      ) : null;
    }
    if (block.type === "tool_call") {
      return (
        <ToolCallStep
          key={block.id}
          name={block.name}
          input={block.input}
          output={block.output}
        />
      );
    }
    if (block.type === "learning_embed") {
      return (
        <LearningEmbed
          key={`le-${i}`}
          reviewId={block.reviewId}
          arxivId={ctx.arxivId}
          paperTitle={ctx.paperTitle}
          paperContext={ctx.paperContext}
          selectedModel={ctx.selectedModel}
        />
      );
    }
    if (block.type === "arxiv_hits") {
      return <ArxivHitsBlock key={`ah-${i}`} query={block.query} results={block.results} />;
    }
    return null;
  });
}

/* ------------------------------------------------------------------ */
/*  ArXiv hits block                                                   */
/* ------------------------------------------------------------------ */

function ArxivHitsBlock({ query, results }: { query: string; results: ArxivSearchResult[] }) {
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/15 p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        arXiv ({results.length} results) &middot;{" "}
        <span className="text-foreground/80">{query}</span>
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

/* ------------------------------------------------------------------ */
/*  Agent steps renderer (live streaming view)                         */
/* ------------------------------------------------------------------ */

function renderAgentSteps(steps: AgentStep[]) {
  return steps.map((step, i) => {
    switch (step.kind) {
      case "thinking":
        return <ThinkingIndicator key={`think-${i}`} />;
      case "text":
        return step.text ? (
          <MarkdownMessage key={`text-${i}`} content={step.text} />
        ) : null;
      case "tool_call":
        return (
          <ToolCallStep
            key={step.id}
            name={step.name}
            input={step.input}
            output={step.output}
            isLive
          />
        );
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Single message renderer                                            */
/* ------------------------------------------------------------------ */

function ChatMessageBubble({
  msg,
  isCurrentlyStreaming,
  agentSteps,
  blockCtx,
}: {
  msg: ChatMessage | AnnotationMessage;
  isCurrentlyStreaming: boolean;
  agentSteps: AgentStep[];
  blockCtx: BlockCtx;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-md px-3 py-2.5 text-sm leading-relaxed border border-border border-l-2 border-l-primary/50 bg-secondary text-foreground">
          <div className="whitespace-pre-wrap">{msg.content}</div>
        </div>
      </div>
    );
  }

  if (isCurrentlyStreaming) {
    return (
      <div className="max-w-full">
        <div className="rounded-md px-3 py-2.5 text-sm leading-relaxed border border-border bg-card text-card-foreground max-w-full">
          {agentSteps.length === 0 ? (
            <ThinkingIndicator />
          ) : (
            renderAgentSteps(agentSteps)
          )}
        </div>
      </div>
    );
  }

  const hasBlocks = msg.blocks && msg.blocks.length > 0;

  if (hasBlocks && hasInterleavedBlocks(msg.blocks!)) {
    return (
      <div className="max-w-full">
        <div className="rounded-md px-3 py-2.5 text-sm leading-relaxed border border-border bg-card text-card-foreground max-w-full">
          {renderInterleavedBlocks(msg.blocks!, blockCtx)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full">
      <div className="rounded-md px-3 py-2.5 text-sm leading-relaxed border border-border bg-card text-card-foreground max-w-full">
        {msg.content ? <MarkdownMessage content={msg.content} /> : null}
        {hasBlocks ? renderInterleavedBlocks(msg.blocks!, blockCtx) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

const STARTERS = [
  {
    icon: BookOpen,
    label: "Prerequisites",
    desc: "Background concepts and papers to read first",
    prompt: "What concepts and background should I understand before reading this paper? Search for the most important prerequisite papers.",
  },
  {
    icon: Network,
    label: "Related work",
    desc: "How this paper connects to neighboring research",
    prompt: "Find the most important related papers to this work. Search arXiv and explain how they connect.",
  },
  {
    icon: Search,
    label: "Key contributions",
    desc: "Main results and how they advance the field",
    prompt: "What are the key contributions of this paper? How do they advance the state of the art?",
  },
  {
    icon: Globe,
    label: "Explain the method",
    desc: "Step-by-step walkthrough with equations",
    prompt: "Walk me through the main method/approach in this paper step by step, including the key equations.",
  },
];

function EmptyState({
  canSend,
  onSend,
}: {
  canSend: boolean;
  onSend: (text: string) => void;
}) {
  return (
    <div className="flex flex-col pb-4 pt-0 font-sans antialiased">
      <div className="mb-4 space-y-1 px-2">
        <p className="text-sm font-semibold leading-snug tracking-tight text-foreground">
          Research assistant
        </p>
        <p className="min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
          Ask anything, or pick a starting point below.
        </p>
      </div>

      <div className="space-y-0.5">
        {STARTERS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={!canSend}
            onClick={() => onSend(s.prompt)}
            className={cn(
              "group flex w-full items-start gap-2.5 rounded-lg px-2 py-2.5 text-left transition-all duration-150",
              canSend
                ? "cursor-pointer hover:bg-foreground/4 active:bg-foreground/6"
                : "cursor-not-allowed opacity-50",
            )}
          >
            <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border/50 bg-foreground/5 transition-colors group-hover:border-border/70 group-hover:bg-foreground/8">
              <s.icon className="size-3 text-foreground/45" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-xs font-medium leading-snug text-foreground/70 transition-colors group-hover:text-foreground/90">
                {s.label}
              </span>
              <p className="text-[11px] leading-snug text-muted-foreground/80">
                {s.desc}
              </p>
            </div>
            <ArrowUpRight
              className="mt-1 size-3 shrink-0 text-muted-foreground/0 transition-all duration-150 group-hover:text-muted-foreground/50"
              strokeWidth={2}
            />
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-start gap-2 px-2">
        <BrainCircuit className="mt-0.5 size-3 shrink-0 text-muted-foreground/35" strokeWidth={1.5} />
        <span className="text-[10px] leading-snug text-muted-foreground/45 not-italic">
          Searches arXiv &amp; the web automatically when needed
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat input                                                         */
/* ------------------------------------------------------------------ */

function ChatInput({
  input,
  setInput,
  sendMessage,
  isStreaming,
  selectedModel,
  hasSavedKeys,
  chatThreadAnnotationId,
}: {
  input: string;
  setInput: (v: string) => void;
  sendMessage: () => Promise<void>;
  isStreaming: boolean;
  selectedModel: Model | null;
  hasSavedKeys: boolean;
  chatThreadAnnotationId: string | null;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollComposerIntoViewRef = useRef(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;

    if (!scrollComposerIntoViewRef.current) return;
    scrollComposerIntoViewRef.current = false;
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
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
          disabled={!selectedModel || !input.trim() || isStreaming}
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
            : "Messages apply to the whole paper."}
        </p>
        <p className="px-1 text-center text-xs leading-snug text-muted-foreground/70">
          {selectedModel
            ? `${selectedModel.label} · Shift+Enter new line`
            : hasSavedKeys
              ? "Choose a model above · Shift+Enter new line"
              : "Manage API keys first · Shift+Enter new line"}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

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
}: ChatPanelProps) {
  const { openSettings } = useSettingsOpener();
  const [internalModel, setInternalModel] = useState<Model | null>(null);

  const selectedModel =
    externalModel !== undefined ? externalModel : internalModel;
  const setSelectedModel = onModelChange ?? setInternalModel;

  const chat = useChat({
    reviewId,
    arxivId,
    paperTitle,
    paperContext,
    selectedModel,
    chatThreadAnnotationId,
    onAnnotationsPersist,
  });

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollComposerIntoViewRef = useRef(false);

  const activeThreadAnn = useMemo(() => {
    if (!chatThreadAnnotationId) return undefined;
    return annotations.find(
      (a) => a.id === chatThreadAnnotationId && a.kind === "ask_ai",
    );
  }, [annotations, chatThreadAnnotationId]);

  const displayThread = useMemo(
    () => chat.displayThread.length > 0 ? chat.displayThread : (activeThreadAnn?.thread ?? []),
    [chat.displayThread, activeThreadAnn?.thread],
  );

  // Auto-scroll on new content
  useLayoutEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const thresholdPx = 120;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist <= thresholdPx) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chat.messages, chat.agentSteps, displayThread]);

  // Reset thread when annotation is gone
  useEffect(() => {
    if (chatThreadAnnotationId && !activeThreadAnn) {
      onChatThreadChange(null);
    }
  }, [chatThreadAnnotationId, activeThreadAnn, onChatThreadChange]);

  // Scroll to top on new thread
  useEffect(() => {
    if (!chatThreadAnnotationId) return;
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [chatThreadAnnotationId]);

  // Handle external prompt
  useEffect(() => {
    if (!externalPrompt) return;
    scrollComposerIntoViewRef.current = true;
    chat.setInput(externalPrompt);
    onExternalPromptConsumed?.();
    const safety = window.setTimeout(() => {
      scrollComposerIntoViewRef.current = false;
    }, 600);
    return () => clearTimeout(safety);
  }, [externalPrompt, onExternalPromptConsumed, chat.setInput]);

  // Scroll composer into view when input changes externally
  useEffect(() => {
    if (!scrollComposerIntoViewRef.current) return;
    scrollComposerIntoViewRef.current = false;

    const scrollMessagesToBottom = () => {
      const el = scrollAreaRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    scrollMessagesToBottom();
    requestAnimationFrame(() => {
      scrollMessagesToBottom();
      requestAnimationFrame(scrollMessagesToBottom);
    });
    setTimeout(scrollMessagesToBottom, 0);
  }, [chat.input]);

  const openKeysForChat = () => {
    if (selectedModel) openSettings({ provider: selectedModel.provider });
    else openSettings();
  };

  const blockCtx: BlockCtx = { reviewId, arxivId, paperTitle, paperContext, selectedModel };

  /* ---------------------------------------------------------------- */
  /*  JSX                                                              */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {!hideHeader && (
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Assistant
          </span>
          <ModelSelector selected={selectedModel} onSelect={setSelectedModel} />
        </div>
      )}

      <div
        ref={scrollAreaRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        <div className="space-y-5 px-4 pb-5 pt-5">
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
                    Ask a question about this passage below.
                  </p>
                </div>
              )}

              {displayThread.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  msg={msg}
                  isCurrentlyStreaming={msg.id === chat.streamingMsgId && chat.isStreaming}
                  agentSteps={chat.agentSteps}
                  blockCtx={blockCtx}
                />
              ))}
            </>
          ) : (
            <>
              {chat.messages.length === 0 && (
                <EmptyState
                  canSend={!!selectedModel && chat.hasKeyForModel && !chat.isStreaming}
                  onSend={chat.submitChat}
                />
              )}

              {chat.messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  msg={msg}
                  isCurrentlyStreaming={msg.id === chat.streamingMsgId && chat.isStreaming}
                  agentSteps={chat.agentSteps}
                  blockCtx={blockCtx}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {selectedModel && !chat.hasKeyForModel && (
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

      {chat.error && (
        <div className="mx-3 mb-2 px-3 py-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm leading-snug space-y-2">
          <p>{chat.error}</p>
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

      <ChatInput
        input={chat.input}
        setInput={chat.setInput}
        sendMessage={chat.sendMessage}
        isStreaming={chat.isStreaming}
        selectedModel={selectedModel}
        hasSavedKeys={chat.hasSavedKeys}
        chatThreadAnnotationId={chatThreadAnnotationId}
      />
    </div>
  );
}
