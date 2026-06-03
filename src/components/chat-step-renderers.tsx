"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Quote,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ShimmerStatus from "./shimmer-status";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import { EXA_KEY_REQUIRED_SENTINEL } from "@/tools/web-search";
import { TextWithPicks, buildPoolFromSteps } from "./picks-shared";
import type { AgentStep } from "@/hooks/use-chat";

/* ------------------------------------------------------------------ */
/*  Tool display helpers                                               */
/* ------------------------------------------------------------------ */

const TOOL_LABELS: Record<string, [string, string]> = {
  arxiv_search: ["Searching arXiv", "Searched arXiv"],
  web_search: ["Searching the web", "Searched the web"],
  read_section: ["Reading section", "Read section"],
  search_paper: ["Searching the paper", "Searched the paper"],
  lookup_citation: ["Looking up citation", "Looked up citation"],
};

function toolLabel(name: string, done: boolean): string {
  const entry = TOOL_LABELS[name];
  if (entry) return done ? entry[1] : entry[0];
  return done ? `Ran ${name}` : `Running ${name}`;
}

const TOOL_ICONS: Record<string, typeof Search> = {
  arxiv_search: Search,
  web_search: Search,
  read_section: BookOpen,
  search_paper: Search,
  lookup_citation: Quote,
};

/* ------------------------------------------------------------------ */
/*  ThinkingIndicator                                                  */
/* ------------------------------------------------------------------ */

export function ThinkingIndicator() {
  return <ShimmerStatus label="Thinking" />;
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

  // web_search returned the "no Exa key" sentinel — show the inline
  // configure card instead of the default tool_result rendering. Done
  // before the rest of the rendering so the user sees one clean prompt.
  if (name === "web_search" && output?.trim() === EXA_KEY_REQUIRED_SENTINEL) {
    return <ExaKeyPromptCard />;
  }

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
            <Check className="size-3 text-success shrink-0" strokeWidth={2.5} />
          )
        ) : (
          <Loader2 className="size-3 text-primary/60 animate-spin shrink-0" />
        )}
        <Icon className="size-3 text-muted-foreground/70 shrink-0" />
        <span
          className={cn(
            "font-medium",
            failed ? "text-destructive/90" : "text-foreground/80",
          )}
        >
          {toolLabel(name, done)}
        </span>
        {queryStr && (
          <span className="text-muted-foreground/70 truncate max-w-45">
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
        <div className="border-t border-border/40 px-2.5 py-2 max-h-45 overflow-y-auto bg-muted/5">
          <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground/80 leading-relaxed">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AgentSteps                                                         */
/*                                                                     */
/*  Component (not function) so we can build the picks metadata pool   */
/*  once via useMemo and reuse it across every text segment in the     */
/*  message. When the agent emits a `**Picks**` list of arxiv links,   */
/*  TextWithPicks splits the text and renders rich cards in place.     */
/* ------------------------------------------------------------------ */

export function AgentSteps({ steps }: { steps: AgentStep[] }) {
  const pool = useMemo(() => buildPoolFromSteps(steps), [steps]);
  return (
    <>
      {steps.map((step, i) => {
        switch (step.kind) {
          case "thinking":
            return <ThinkingIndicator key={`think-${i}`} />;
          case "text":
            return (
              <TextWithPicks key={`text-${i}`} text={step.text} pool={pool} />
            );
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
      })}
    </>
  );
}
