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
import type { StreamEvent } from "@/lib/stream-types";

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
    };

/* ------------------------------------------------------------------ */
/*  Stream event → agent steps                                         */
/* ------------------------------------------------------------------ */

export function processStreamEvent(
  steps: AgentStep[],
  event: StreamEvent,
): AgentStep[] {
  const next = [...steps];

  switch (event.type) {
    case "turn_start": {
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

    case "tool_call": {
      if (next.length > 0 && next[next.length - 1].kind === "thinking") {
        next.pop();
      }
      next.push({
        kind: "tool_call",
        id: event.id,
        name: event.name,
        input: event.input,
      });
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
    } else if (step.kind === "tool_call") {
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
