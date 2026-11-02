/**
 * A discover run's trajectory: the agent steps the live view renders, kept
 * with the brief so the finished page can show the same research rail
 * (searches and what they found, grading, close reads, the picks) instead of
 * dropping it when the stream ends.
 */

import type { AgentStep } from "@/lib/agent-steps";

/** Per-output cap. Search outputs list every result with its abstract; the
 *  rail only needs titles, years and links from the head of each list. */
const MAX_OUTPUT_CHARS = 20_000;
const MAX_TEXT_CHARS = 4_000;

type ToolStep = Extract<AgentStep, { kind: "tool_call" }>;

/** The steps worth keeping, trimmed for storage: finished tool calls and the
 *  agent's working notes. Thinking markers, half-built calls, and streaming
 *  progress are dropped. */
export function compactTrajectory(steps: AgentStep[]): AgentStep[] {
  const out: AgentStep[] = [];
  for (const s of steps) {
    if (s.kind === "text") {
      const text = s.text.trim();
      if (text) out.push({ kind: "text", text: text.slice(0, MAX_TEXT_CHARS) });
    } else if (s.kind === "tool_call" && !s.building) {
      const step: ToolStep = {
        kind: "tool_call",
        id: s.id,
        name: s.name,
        input: s.input,
      };
      if (s.output !== undefined) step.output = s.output.slice(0, MAX_OUTPUT_CHARS);
      out.push(step);
    }
  }
  return out;
}

/** Reads a stored trajectory back, skipping anything malformed. */
export function parseTrajectory(raw: unknown): AgentStep[] | null {
  if (!Array.isArray(raw)) return null;
  const steps: AgentStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (s.kind === "text" && typeof s.text === "string") {
      steps.push({ kind: "text", text: s.text });
    } else if (
      s.kind === "tool_call" &&
      typeof s.id === "string" &&
      typeof s.name === "string" &&
      s.input &&
      typeof s.input === "object" &&
      !Array.isArray(s.input)
    ) {
      steps.push({
        kind: "tool_call",
        id: s.id,
        name: s.name,
        input: s.input as Record<string, unknown>,
        ...(typeof s.output === "string" ? { output: s.output } : {}),
      });
    }
  }
  return steps.length > 0 ? steps : null;
}
