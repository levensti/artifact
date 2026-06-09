"use client";

import { useContext, useLayoutEffect, useMemo } from "react";
import { AlertCircle, KeyRound, RotateCw } from "lucide-react";
import type { ArxivSearchResult } from "@/lib/explore";
import type { ChatAssistantBlock, ChatMessage } from "@/lib/review-types";
import type { AnnotationMessage } from "@/lib/annotations";
import MarkdownMessage, { MarkdownStreamingBoundary } from "./markdown-message";
import {
  ThinkingIndicator,
  ToolCallStep,
  AgentSteps,
} from "./chat-step-renderers";
import { TextWithPicks, buildPoolFromBlocks } from "./picks-shared";
import { useStreamingSteps } from "@/lib/streaming-store";
import { ChatScrollContext } from "./chat-panel";

/* ------------------------------------------------------------------ */
/*  ArXiv hits block                                                   */
/* ------------------------------------------------------------------ */

export function ArxivHitsBlock({
  query,
  results,
}: {
  query: string;
  results: ArxivSearchResult[];
}) {
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/15 p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        arXiv ({results.length} results) &middot;{" "}
        <span className="text-foreground/80">{query}</span>
      </p>
      <ul className="space-y-2 max-h-60 overflow-y-auto">
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

/* ------------------------------------------------------------------ */
/*  Interleaved blocks renderer (for persisted messages)               */
/* ------------------------------------------------------------------ */

export function hasInterleavedBlocks(blocks: ChatAssistantBlock[]): boolean {
  return blocks.some(
    (b) => b.type === "text_segment" || b.type === "tool_call",
  );
}

export function InterleavedBlocks({ blocks }: { blocks: ChatAssistantBlock[] }) {
  const pool = useMemo(() => buildPoolFromBlocks(blocks), [blocks]);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === "text_segment") {
          return block.content ? (
            <TextWithPicks key={`ts-${i}`} text={block.content} pool={pool} />
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
        if (block.type === "arxiv_hits") {
          return (
            <ArxivHitsBlock
              key={`ah-${i}`}
              query={block.query}
              results={block.results}
            />
          );
        }
        return null;
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Single message renderer                                            */
/* ------------------------------------------------------------------ */

// Subscribes to the per-delta streaming buffer. Kept as a separate component
// so that only the bubble that is *currently* streaming subscribes — sibling
// bubbles and the rest of the panel never re-render per token.
function StreamingMessageBody() {
  const agentSteps = useStreamingSteps();
  const scrollIfPinned = useContext(ChatScrollContext);
  // Runs after React commits the new typewriter frame, so scrollHeight is
  // up to date. Doing this in a store subscriber would read stale layout.
  useLayoutEffect(() => {
    scrollIfPinned();
  }, [agentSteps, scrollIfPinned]);
  return (
    <div className="max-w-full text-[15px] leading-relaxed text-foreground">
      {agentSteps.length === 0 ? (
        <ThinkingIndicator />
      ) : (
        <MarkdownStreamingBoundary>
          <AgentSteps steps={agentSteps} />
        </MarkdownStreamingBoundary>
      )}
    </div>
  );
}

export function ChatMessageBubble({
  msg,
  isCurrentlyStreaming,
  failure,
}: {
  msg: ChatMessage | AnnotationMessage;
  isCurrentlyStreaming: boolean;
  /** When set, render an inline failure indicator beneath this user message. */
  failure?: {
    error: string;
    canRetry: boolean;
    onRetry: () => void;
    /** "rate_limit" swaps the generic error for an add-your-key prompt. */
    kind?: "rate_limit";
    onAddKey?: () => void;
  } | null;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[80%] rounded-[18px] border border-primary/20 bg-primary/10 px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
          <div className="whitespace-pre-wrap">{msg.content}</div>
        </div>
        {failure?.kind === "rate_limit" ? (
          <div className="mt-1 flex max-w-[88%] flex-col gap-2 rounded-xl border border-primary/20 bg-primary/[0.04] px-3.5 py-3">
            <div className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-tight text-foreground">
              <KeyRound
                className="size-3.5 shrink-0"
                strokeWidth={2}
                style={{
                  color: "color-mix(in srgb, var(--primary) 75%, transparent)",
                }}
              />
              You&rsquo;ve hit the current usage limit
            </div>
            <p
              className="text-[12px] leading-relaxed text-muted-foreground"
              style={{ fontFamily: "var(--font-reading)" }}
            >
              Add your own OpenRouter key for higher limits, then resend.
            </p>
            <div className="flex items-center gap-2">
              {failure.onAddKey && (
                <button
                  type="button"
                  onClick={failure.onAddKey}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <KeyRound className="size-3" strokeWidth={2} />
                  Add your key
                </button>
              )}
              {failure.canRetry && (
                <button
                  type="button"
                  onClick={failure.onRetry}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <RotateCw className="size-3" strokeWidth={2.25} />
                  Retry
                </button>
              )}
            </div>
          </div>
        ) : failure ? (
          <div className="flex max-w-[85%] flex-col items-end gap-0.5 pr-1">
            <div className="flex items-center gap-1.5 text-[11px] text-destructive/90">
              <AlertCircle className="size-3" strokeWidth={2.25} />
              <span>Couldn&rsquo;t send</span>
              {failure.canRetry && (
                <>
                  <span className="text-destructive/40">·</span>
                  <button
                    type="button"
                    onClick={failure.onRetry}
                    className="inline-flex items-center gap-0.5 font-medium text-destructive underline-offset-2 hover:underline"
                  >
                    <RotateCw className="size-2.5" strokeWidth={2.5} />
                    Retry
                  </button>
                </>
              )}
            </div>
            <p
              className="text-right text-[10.5px] leading-snug text-destructive/70"
              title={failure.error}
            >
              {failure.error}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  if (isCurrentlyStreaming) {
    return <StreamingMessageBody />;
  }

  const hasBlocks = msg.blocks && msg.blocks.length > 0;

  if (hasBlocks && hasInterleavedBlocks(msg.blocks!)) {
    return (
      <div className="max-w-full text-[15px] leading-relaxed text-foreground">
        <InterleavedBlocks blocks={msg.blocks!} />
      </div>
    );
  }

  return (
    <div className="max-w-full text-[15px] leading-relaxed text-foreground">
      {msg.content ? <MarkdownMessage content={msg.content} /> : null}
      {hasBlocks ? <InterleavedBlocks blocks={msg.blocks!} /> : null}
    </div>
  );
}
