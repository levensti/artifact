"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Globe,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThinkingIndicator } from "./chat-step-renderers";
import BraveKeyPromptCard from "./brave-key-prompt-card";
import { BRAVE_KEY_REQUIRED_SENTINEL } from "@/tools/web-search";
import { PaperCard, parseArxivSearchOutput } from "./discover-arxiv-cards";
import { TextWithPicks, buildPoolFromSteps } from "./picks-shared";
import type { AgentStep } from "@/hooks/use-chat";

/* ------------------------------------------------------------------ */
/*  Search chip — collapsed tool_call with cards in expanded pane      */
/* ------------------------------------------------------------------ */

function resultCount(name: string, output: string | undefined): number | null {
  if (!output) return null;
  if (name === "arxiv_search") {
    const m = output.match(/^Found (\d+) papers/m);
    return m ? Number(m[1]) : null;
  }
  if (name === "web_search") {
    const m = output.match(/^Found (\d+) web results/m);
    return m ? Number(m[1]) : null;
  }
  return null;
}

const TOOL_DISPLAY: Record<string, { active: string; done: string }> = {
  arxiv_search: { active: "Searching", done: "Searched" },
  web_search: { active: "Searching", done: "Searched" },
  paper_details: { active: "Verifying", done: "Verified" },
};

function chipSubject(name: string, input: Record<string, unknown>): string | null {
  if (name === "paper_details") {
    return typeof input.arxivId === "string" ? input.arxivId : null;
  }
  return typeof input.query === "string" ? `"${input.query}"` : null;
}

function SearchChip({
  name,
  input,
  output,
}: {
  name: string;
  input: Record<string, unknown>;
  output?: string;
}) {
  const [open, setOpen] = useState(false);

  if (name === "web_search" && output?.trim() === BRAVE_KEY_REQUIRED_SENTINEL) {
    return <BraveKeyPromptCard />;
  }

  const done = !!output;
  const trimmedOutput = (output ?? "").trim();
  const failed =
    done &&
    /^(?:error:|paper search failed:|web search failed:|request failed:|no papers found|no web results)/i.test(
      trimmedOutput,
    );
  const subject = chipSubject(name, input);
  const count = done ? resultCount(name, output) : null;
  const display = TOOL_DISPLAY[name];
  const verb = display
    ? done
      ? display.done
      : display.active
    : done
      ? "Ran"
      : "Running";
  const displayName =
    name === "web_search" ? "web" : name === "paper_details" ? "paper" : "papers";

  // Expanded pane: for arxiv_search show the same card list users used to see
  // auto-rendered, so the full candidate set is still browsable behind the
  // chip. web_search falls back to raw text.
  const expanded = !output ? null : name === "arxiv_search" ? (
    (() => {
      const { papers } = parseArxivSearchOutput(output);
      if (papers.length === 0) {
        return (
          <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground/80 leading-relaxed">
            {output.trim()}
          </pre>
        );
      }
      return (
        <div className="grid grid-cols-1 gap-2">
          {papers.map((p, i) => (
            <PaperCard key={`${p.url || p.title}-${i}`} paper={p} />
          ))}
        </div>
      );
    })()
  ) : (
    <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground/80 leading-relaxed">
      {output.trim()}
    </pre>
  );

  return (
    <div className="my-1.5 rounded-md border border-border/70 bg-muted/15 text-xs overflow-hidden">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors",
          done && "hover:bg-muted/30 cursor-pointer",
          !done && "cursor-default",
        )}
        onClick={() => done && setOpen((v) => !v)}
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
        {name === "web_search" ? (
          <Globe className="size-3 text-muted-foreground/70 shrink-0" />
        ) : name === "paper_details" ? (
          <FileText className="size-3 text-muted-foreground/70 shrink-0" />
        ) : (
          <Search className="size-3 text-muted-foreground/70 shrink-0" />
        )}
        <span
          className={cn(
            "font-medium",
            failed ? "text-destructive/90" : "text-foreground/80",
          )}
        >
          {verb} {displayName}
        </span>
        {subject ? (
          <span className="truncate max-w-[28ch] text-muted-foreground/70">
            · {subject}
          </span>
        ) : null}
        {count !== null ? (
          <span className="text-muted-foreground/60 shrink-0">
            · {count} results
          </span>
        ) : null}
        {done ? (
          <span className="ml-auto text-muted-foreground/50 shrink-0">
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </span>
        ) : null}
      </button>
      {open && expanded ? (
        <div className="border-t border-border/40 bg-muted/5 px-2.5 py-2 max-h-[28rem] overflow-y-auto">
          {expanded}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Public: DiscoverSteps                                              */
/* ------------------------------------------------------------------ */

export default function DiscoverSteps({ steps }: { steps: AgentStep[] }) {
  const pool = useMemo(() => buildPoolFromSteps(steps), [steps]);

  return (
    <>
      {steps.map((step, i) => {
        switch (step.kind) {
          case "thinking":
            return <ThinkingIndicator key={`think-${i}`} />;
          case "tool_call":
            // submit_picks is a finalize signal, not a meaningful user-facing
            // step. The agent's closing text confirmation is enough; the
            // queue itself is the visible outcome.
            if (step.name === "submit_picks") return null;
            return (
              <SearchChip
                key={step.id}
                name={step.name}
                input={step.input}
                output={step.output}
              />
            );
          case "text":
            return (
              <TextWithPicks key={`text-${i}`} text={step.text} pool={pool} />
            );
        }
      })}
    </>
  );
}
