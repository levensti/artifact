"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import type { Model } from "@/lib/models";
import type { ArxivSearchResult } from "@/lib/explore";
import type { ChatAssistantBlock, ChatMessage } from "@/lib/review-types";
import type { AnnotationMessage } from "@/lib/annotations";
import MarkdownMessage from "./markdown-message";
import LearningEmbed from "./learning-embed";
import {
  ThinkingIndicator,
  ToolCallStep,
  renderAgentSteps,
} from "./chat-step-renderers";
import type { AgentStep } from "@/hooks/use-chat";

/* ------------------------------------------------------------------ */
/*  Block context (shared by interleaved block renderers)              */
/* ------------------------------------------------------------------ */

export interface BlockCtx {
  reviewId: string;
  arxivId: string;
  paperTitle: string;
  paperContext: string;
  selectedModel: Model | null;
}

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

/* ------------------------------------------------------------------ */
/*  Interleaved blocks renderer (for persisted messages)               */
/* ------------------------------------------------------------------ */

export function hasInterleavedBlocks(blocks: ChatAssistantBlock[]): boolean {
  return blocks.some(
    (b) => b.type === "text_segment" || b.type === "tool_call",
  );
}

export function renderInterleavedBlocks(blocks: ChatAssistantBlock[], ctx: BlockCtx) {
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
      return (
        <ArxivHitsBlock
          key={`ah-${i}`}
          query={block.query}
          results={block.results}
        />
      );
    }
    return null;
  });
}

/* ------------------------------------------------------------------ */
/*  Single message renderer                                            */
/* ------------------------------------------------------------------ */

export function ChatMessageBubble({
  msg,
  isCurrentlyStreaming,
  agentSteps,
  blockCtx,
  failure,
}: {
  msg: ChatMessage | AnnotationMessage;
  isCurrentlyStreaming: boolean;
  agentSteps: AgentStep[];
  blockCtx: BlockCtx;
  /** When set, render an inline failure indicator beneath this user message. */
  failure?: {
    error: string;
    canRetry: boolean;
    onRetry: () => void;
  } | null;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-3 text-sm leading-relaxed bg-primary/10 text-foreground shadow-sm">
          <div className="whitespace-pre-wrap">{msg.content}</div>
        </div>
        {failure && (
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
        )}
      </div>
    );
  }

  if (isCurrentlyStreaming) {
    return (
      <div className="max-w-full">
        <div className="rounded-xl border-l-[3px] border-l-primary/30 px-4 py-3 text-sm leading-relaxed bg-card text-card-foreground shadow-sm max-w-full">
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
        <div className="rounded-xl border-l-[3px] border-l-primary/30 px-4 py-3 text-sm leading-relaxed bg-card text-card-foreground shadow-sm max-w-full">
          {renderInterleavedBlocks(msg.blocks!, blockCtx)}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-full">
      <div className="rounded-xl border-l-[3px] border-l-primary/30 px-4 py-3 text-sm leading-relaxed bg-card text-card-foreground shadow-sm max-w-full">
        {msg.content ? <MarkdownMessage content={msg.content} /> : null}
        {hasBlocks ? renderInterleavedBlocks(msg.blocks!, blockCtx) : null}
      </div>
    </div>
  );
}
