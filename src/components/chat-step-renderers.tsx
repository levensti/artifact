"use client";

import { useState } from "react";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownMessage from "./markdown-message";
import type { AgentStep } from "@/hooks/use-chat";

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
/*  ThinkingIndicator                                                  */
/* ------------------------------------------------------------------ */

export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <BrainCircuit className="size-3.5 text-primary/60 animate-pulse shrink-0" />
      <span className="text-xs text-muted-foreground font-medium">
        Thinking…
      </span>
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

/* ------------------------------------------------------------------ */
/*  ToolCallStep                                                       */
/* ------------------------------------------------------------------ */

export function ToolCallStep({
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
  const normalizedOutput = (output ?? "").trim().toLowerCase();
  const failed =
    done &&
    (normalizedOutput.startsWith("error:") ||
      normalizedOutput.startsWith("paper search failed:") ||
      normalizedOutput.startsWith("request failed:"));
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
          failed ? (
            <X className="size-3 text-destructive shrink-0" strokeWidth={2.5} />
          ) : (
            <Check
              className="size-3 text-emerald-600 shrink-0"
              strokeWidth={2.5}
            />
          )
        ) : (
          <Loader2 className="size-3 text-primary/60 animate-spin shrink-0" />
        )}
        <Icon className="size-3 text-muted-foreground/70 shrink-0" />
        <span className={cn("font-medium", failed ? "text-destructive/90" : "text-foreground/80")}>
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
/*  renderAgentSteps                                                   */
/* ------------------------------------------------------------------ */

export function renderAgentSteps(steps: AgentStep[]) {
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
