/**
 * Agent step assembly — the shared, provider-agnostic logic that turns a
 * stream of NDJSON `StreamEvent`s into ordered `AgentStep`s, and those steps
 * into persistable `ChatAssistantBlock`s.
 *
 * This lives in `lib` (not in the `use-chat` client hook) because BOTH sides
 * run it: the browser uses it to render the live stream, and the server uses
 * it to assemble the assistant turn it persists. Keeping one implementation
 * guarantees the rendered message and the stored message can't diverge.
 */

import type { ChatAssistantBlock } from "@/lib/review-types";
import type { StreamEvent, ToolProgress } from "@/lib/stream-types";
import { CREATE_ARTIFACT_TOOL } from "@/lib/artifacts";

/** A single rendered/streamed step in an agent turn. */
export type AgentStep =
  | { kind: "thinking" }
  | { kind: "text"; text: string }
  | {
      kind: "tool_call";
      id: string;
      name: string;
      input: Record<string, unknown>;
      output?: string;
      /** The arguments are still streaming (tool_call_start seen, no
       *  tool_call yet); `input` is empty until they're complete. */
      building?: boolean;
      /** Partial-argument progress while building (tool_call_progress). */
      progress?: ToolProgress;
    };

/**
 * Settle steps still building when a round ends: their tool_call never came
 * (e.g. the model hit its output limit mid-arguments), so the tool never ran.
 * An artifact becomes a short note so the user knows what happened (it's
 * plain text, so it persists and the model sees it next turn); any other
 * tool just drops.
 */
function settleBuilding(steps: AgentStep[]): AgentStep[] {
  if (!steps.some((s) => s.kind === "tool_call" && s.building)) return steps;
  return steps.flatMap((s): AgentStep[] => {
    if (s.kind !== "tool_call" || !s.building) return [s];
    if (s.name !== CREATE_ARTIFACT_TOOL) return [];
    const what = s.progress?.title ? `"${s.progress.title}"` : "The artifact";
    return [
      {
        kind: "text",
        text: `\n\n*${what} was cut off before it finished. Ask again, or ask for a shorter version.*\n\n`,
      },
    ];
  });
}

/* ------------------------------------------------------------------ */
/*  Stream event → agent steps                                         */
/* ------------------------------------------------------------------ */

export function processStreamEvent(
  steps: AgentStep[],
  event: StreamEvent,
): AgentStep[] {
  let next = [...steps];

  switch (event.type) {
    case "turn_start": {
      next = settleBuilding(next);
      const last = next[next.length - 1];
      if (last && last.kind === "tool_call" && last.output !== undefined) {
        next.push({ kind: "thinking" });
      } else if (next.length === 0) {
        next.push({ kind: "thinking" });
      }
      break;
    }

    case "text_delta": {
      if (next.length > 0 && next[next.length - 1].kind === "thinking") {
        next.pop();
      }
      const last = next[next.length - 1];
      if (last && last.kind === "text") {
        next[next.length - 1] = { kind: "text", text: last.text + event.text };
      } else {
        next.push({ kind: "text", text: event.text });
      }
      break;
    }

    case "tool_call_start": {
      if (next.length > 0 && next[next.length - 1].kind === "thinking") {
        next.pop();
      }
      next.push({
        kind: "tool_call",
        id: event.id,
        name: event.name,
        input: {},
        building: true,
      });
      break;
    }

    case "tool_call_progress": {
      const i = next.findIndex(
        (s) => s.kind === "tool_call" && s.id === event.id && s.building,
      );
      if (i >= 0) {
        next[i] = {
          ...(next[i] as AgentStep & { kind: "tool_call" }),
          progress: event.progress,
        };
      }
      break;
    }

    case "tool_call": {
      if (next.length > 0 && next[next.length - 1].kind === "thinking") {
        next.pop();
      }
      const step: AgentStep = {
        kind: "tool_call",
        id: event.id,
        name: event.name,
        input: event.input,
      };
      // Complete the step tool_call_start opened, in place.
      const i = next.findIndex(
        (s) => s.kind === "tool_call" && s.id === event.id,
      );
      if (i >= 0) next[i] = step;
      else next.push(step);
      break;
    }

    case "tool_result": {
      for (let i = next.length - 1; i >= 0; i--) {
        const step = next[i];
        if (step.kind === "tool_call" && step.id === event.id) {
          next[i] = { ...step, output: event.output };
          break;
        }
      }
      break;
    }

    case "done": {
      next = settleBuilding(next);
      if (next.length > 0 && next[next.length - 1].kind === "thinking") {
        next.pop();
      }
      break;
    }
  }

  return next;
}

/* ------------------------------------------------------------------ */
/*  Steps → persistence helpers                                        */
/* ------------------------------------------------------------------ */

/** Convert agent steps to ordered blocks for persistence. */
export function stepsToBlocks(steps: AgentStep[]): ChatAssistantBlock[] {
  const blocks: ChatAssistantBlock[] = [];
  for (const step of steps) {
    if (step.kind === "text" && step.text) {
      blocks.push({ type: "text_segment", content: step.text });
    } else if (step.kind === "tool_call" && !step.building) {
      // Unfinished calls never ran, so there's nothing to replay or show.
      blocks.push({
        type: "tool_call",
        id: step.id,
        name: step.name,
        input: step.input,
        output: step.output,
      });
    }
  }
  return blocks;
}

/** Extract concatenated text from steps (for the content field). */
export function stepsToContent(steps: AgentStep[]): string {
  return steps
    .filter((s): s is AgentStep & { kind: "text" } => s.kind === "text")
    .map((s) => s.text)
    .join("");
}
