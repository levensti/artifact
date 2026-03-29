import { describe, it, expect } from "vitest";
import {
  processStreamEvent,
  stepsToBlocks,
  stepsToContent,
  type AgentStep,
} from "@/hooks/use-chat";

describe("processStreamEvent", () => {
  it("adds thinking indicator on first turn_start", () => {
    const steps = processStreamEvent([], { type: "turn_start" });
    expect(steps).toEqual([{ kind: "thinking" }]);
  });

  it("replaces thinking with text on text_delta", () => {
    let steps: AgentStep[] = [{ kind: "thinking" }];
    steps = processStreamEvent(steps, { type: "text_delta", text: "Hello" });
    expect(steps).toEqual([{ kind: "text", text: "Hello" }]);
  });

  it("appends to existing text step", () => {
    let steps: AgentStep[] = [{ kind: "text", text: "Hello" }];
    steps = processStreamEvent(steps, { type: "text_delta", text: " world" });
    expect(steps).toEqual([{ kind: "text", text: "Hello world" }]);
  });

  it("adds tool_call step and removes thinking", () => {
    let steps: AgentStep[] = [{ kind: "thinking" }];
    steps = processStreamEvent(steps, {
      type: "tool_call",
      id: "tc1",
      name: "arxiv_search",
      input: { query: "transformers" },
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].kind).toBe("tool_call");
  });

  it("attaches output to matching tool_call on tool_result", () => {
    let steps: AgentStep[] = [
      { kind: "tool_call", id: "tc1", name: "arxiv_search", input: { query: "test" } },
    ];
    steps = processStreamEvent(steps, {
      type: "tool_result",
      id: "tc1",
      name: "arxiv_search",
      output: "Found 3 papers",
    });
    expect(steps[0].kind).toBe("tool_call");
    if (steps[0].kind === "tool_call") {
      expect(steps[0].output).toBe("Found 3 papers");
    }
  });

  it("adds thinking after completed tool call on new turn_start", () => {
    const steps: AgentStep[] = [
      { kind: "tool_call", id: "tc1", name: "search", input: {}, output: "done" },
    ];
    const result = processStreamEvent(steps, { type: "turn_start" });
    expect(result).toHaveLength(2);
    expect(result[1].kind).toBe("thinking");
  });

  it("removes trailing thinking on done", () => {
    const steps: AgentStep[] = [
      { kind: "text", text: "Answer" },
      { kind: "thinking" },
    ];
    const result = processStreamEvent(steps, { type: "done" });
    expect(result).toEqual([{ kind: "text", text: "Answer" }]);
  });
});

describe("stepsToBlocks", () => {
  it("converts text steps to text_segment blocks", () => {
    const steps: AgentStep[] = [{ kind: "text", text: "Hello" }];
    const blocks = stepsToBlocks(steps);
    expect(blocks).toEqual([{ type: "text_segment", content: "Hello" }]);
  });

  it("converts tool_call steps to tool_call blocks", () => {
    const steps: AgentStep[] = [
      { kind: "tool_call", id: "tc1", name: "search", input: { q: "test" }, output: "result" },
    ];
    const blocks = stepsToBlocks(steps);
    expect(blocks).toEqual([
      { type: "tool_call", id: "tc1", name: "search", input: { q: "test" }, output: "result" },
    ]);
  });

  it("skips thinking steps", () => {
    const steps: AgentStep[] = [{ kind: "thinking" }, { kind: "text", text: "hi" }];
    const blocks = stepsToBlocks(steps);
    expect(blocks).toHaveLength(1);
  });

  it("skips empty text steps", () => {
    const steps: AgentStep[] = [{ kind: "text", text: "" }];
    const blocks = stepsToBlocks(steps);
    expect(blocks).toHaveLength(0);
  });
});

describe("stepsToContent", () => {
  it("concatenates text from text steps only", () => {
    const steps: AgentStep[] = [
      { kind: "text", text: "Hello " },
      { kind: "tool_call", id: "t1", name: "s", input: {} },
      { kind: "text", text: "world" },
    ];
    expect(stepsToContent(steps)).toBe("Hello world");
  });

  it("returns empty string for no text steps", () => {
    const steps: AgentStep[] = [{ kind: "thinking" }];
    expect(stepsToContent(steps)).toBe("");
  });
});
