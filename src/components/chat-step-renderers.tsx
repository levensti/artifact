"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  LayoutPanelTop,
  Loader2,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ShimmerStatus from "./shimmer-status";
import ExaKeyPromptCard from "./exa-key-prompt-card";
import { EXA_KEY_REQUIRED_SENTINEL } from "@/tools/web-search";
import {
  artifactRefFromOutput,
  CREATE_ARTIFACT_TOOL,
  UPDATE_ARTIFACT_TOOL,
} from "@/lib/artifacts";
import type { ToolProgress } from "@/lib/stream-types";
import { ArtifactChatCard } from "./artifact-view";
import { TextWithPicks, buildPoolFromSteps } from "./picks-shared";
import type { AgentStep } from "@/hooks/use-chat";

/* ------------------------------------------------------------------ */
/*  Tool display helpers                                               */
/* ------------------------------------------------------------------ */

const TOOL_LABELS: Record<string, [string, string]> = {
  arxiv_search: ["Searching arXiv", "Searched arXiv"],
  web_search: ["Searching the web", "Searched the web"],
  search_paper: ["Searching the document", "Searched the document"],
  create_artifact: ["Building the artifact", "Built the artifact"],
  update_artifact: ["Editing the artifact", "Edited the artifact"],
  read_artifact: ["Reading the artifact", "Read the artifact"],
};

function toolLabel(name: string, done: boolean): string {
  const entry = TOOL_LABELS[name];
  if (entry) return done ? entry[1] : entry[0];
  return done ? `Ran ${name}` : `Running ${name}`;
}

const TOOL_ICONS: Record<string, typeof Search> = {
  arxiv_search: Search,
  web_search: Search,
  search_paper: Search,
};

/* ------------------------------------------------------------------ */
/*  ThinkingIndicator                                                  */
/* ------------------------------------------------------------------ */

/**
 * When the current assistant turn started (ms since epoch), provided by the
 * streaming message body so every thinking indicator in the turn counts
 * from the user's send rather than from its own mount. Null outside a
 * streaming turn.
 */
export const TurnStartContext = createContext<number | null>(null);

/**
 * "Thinking" with a running elapsed-seconds counter measured from the start
 * of the turn (see TurnStartContext), so it reads as the user's wait so far
 * and does not reset after each tool call. The count appears from the first
 * second; its purpose is to show a long silent reasoning pass is still alive
 * rather than hung.
 */
export function ThinkingIndicator() {
  const elapsed = useTurnElapsed();
  const label = elapsed >= 1 ? `Thinking · ${formatElapsed(elapsed)}` : "Thinking";
  return <ShimmerStatus label={label} />;
}

/** Seconds since the turn started (or since mount outside a turn), ticking. */
function useTurnElapsed(): number {
  const turnStart = useContext(TurnStartContext);
  const [elapsed, setElapsed] = useState(() =>
    turnStart ? Math.floor((Date.now() - turnStart) / 1000) : 0,
  );
  useEffect(() => {
    const startedAt = turnStart ?? Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [turnStart]);
  return elapsed;
}

/* ------------------------------------------------------------------ */
/*  ArtifactBuildingCard                                               */
/* ------------------------------------------------------------------ */

/**
 * Stands in for an artifact while the model writes it (its arguments are
 * streaming): the title once it's written, then each section as it lands, so
 * a long generation reads as visible progress rather than "Thinking".
 */
function ArtifactBuildingCard({
  progress,
  editing,
}: {
  progress?: ToolProgress;
  /** An update_artifact call: its progress title is the one-line change. */
  editing?: boolean;
}) {
  const elapsed = useTurnElapsed();
  const title = progress?.title;
  const steps = progress?.steps ?? [];

  const label = editing
    ? title
      ? `Editing the artifact: ${title}`
      : "Editing the artifact"
    : title
      ? `Building "${title}"`
      : "Building an artifact";
  return (
    <div className="my-2 rounded-lg border border-border bg-card px-3.5 py-3">
      <div className="flex items-center gap-2">
        <LayoutPanelTop
          className="size-3.5 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <ShimmerStatus label={label} />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
          {formatElapsed(elapsed)}
        </span>
      </div>
      {steps.length > 0 ? (
        <ul className="mt-2 space-y-1 pl-[22px] text-[12px] leading-snug">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-1.5">
              {step.done ? (
                <Check
                  className="mt-px size-3 shrink-0 text-success"
                  strokeWidth={2.5}
                  aria-label="Written"
                />
              ) : (
                <Loader2
                  className="mt-px size-3 shrink-0 animate-spin text-muted-foreground/70"
                  aria-label="Writing"
                />
              )}
              <span
                className={step.done ? "text-muted-foreground" : "text-foreground"}
              >
                {step.label}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/** Did this create/update call save an artifact? Its output carries a ref,
 *  or (turns saved before refs) says the artifact was created. */
function savedArtifactCall(name: string, output: string): boolean {
  if (artifactRefFromOutput(output)) return true;
  return name === CREATE_ARTIFACT_TOOL && /^Artifact ".*" created/.test(output);
}

/* ------------------------------------------------------------------ */
/*  ToolCallStep                                                       */
/* ------------------------------------------------------------------ */

export function ToolCallStep({
  id,
  name,
  input,
  output,
  isLive,
  building,
  progress,
}: {
  /** The tool call's id (finds artifacts saved before refs existed). */
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  isLive?: boolean;
  /** Arguments still streaming (live steps only). */
  building?: boolean;
  progress?: ToolProgress;
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

  // create/update_artifact: progress while the page is written, then a card
  // for the saved artifact (or the plain row when the call failed).
  if (name === CREATE_ARTIFACT_TOOL || name === UPDATE_ARTIFACT_TOOL) {
    if (building) {
      return (
        <ArtifactBuildingCard
          progress={progress}
          editing={name === UPDATE_ARTIFACT_TOOL}
        />
      );
    }
    if (output && !failed && savedArtifactCall(name, output)) {
      return (
        <ArtifactChatCard callId={id} name={name} input={input} output={output} />
      );
    }
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
                id={step.id}
                name={step.name}
                input={step.input}
                output={step.output}
                isLive
                building={step.building}
                progress={step.progress}
              />
            );
        }
      })}
    </>
  );
}
