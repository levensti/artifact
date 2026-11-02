import { describe, expect, it } from "vitest";
import {
  compactTrajectory,
  parseTrajectory,
} from "@/lib/discover-trajectory";
import type { AgentStep } from "@/lib/agent-steps";

describe("compactTrajectory", () => {
  it("keeps finished tool calls and notes, drops the rest", () => {
    const steps: AgentStep[] = [
      { kind: "thinking" },
      { kind: "text", text: "  Plan: search two angles.  " },
      { kind: "text", text: "   " },
      {
        kind: "tool_call",
        id: "a",
        name: "arxiv_search",
        input: { query: "q" },
        output: "x".repeat(50_000),
      },
      { kind: "tool_call", id: "b", name: "web_search", input: {}, building: true },
    ];
    const out = compactTrajectory(steps);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ kind: "text", text: "Plan: search two angles." });
    const call = out[1] as Extract<AgentStep, { kind: "tool_call" }>;
    expect(call.name).toBe("arxiv_search");
    expect(call.output!.length).toBe(20_000);
  });
});

describe("parseTrajectory", () => {
  it("round-trips compacted steps and skips malformed entries", () => {
    const steps = compactTrajectory([
      { kind: "text", text: "note" },
      { kind: "tool_call", id: "s", name: "screen_sources", input: { candidates: 3 }, output: "Screened 3" },
    ]);
    const parsed = parseTrajectory([...JSON.parse(JSON.stringify(steps)), null, { kind: "tool_call" }]);
    expect(parsed).toEqual(steps);
  });

  it("returns null for missing or empty trajectories", () => {
    expect(parseTrajectory(null)).toBeNull();
    expect(parseTrajectory([])).toBeNull();
  });
});
