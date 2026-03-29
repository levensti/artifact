import { describe, it, expect } from "vitest";
import {
  getAllTools,
  getToolByName,
  toAnthropicTools,
  toOpenAITools,
} from "@/tools/registry";

describe("tool registry", () => {
  it("returns all registered tools", () => {
    const tools = getAllTools();
    expect(tools.length).toBeGreaterThanOrEqual(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain("arxiv_search");
    expect(names).toContain("web_search");
    expect(names).toContain("rank_results");
  });

  it("finds a tool by name", () => {
    const tool = getToolByName("arxiv_search");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("arxiv_search");
    expect(tool!.parameters.type).toBe("object");
  });

  it("returns undefined for unknown tool", () => {
    expect(getToolByName("nonexistent_tool")).toBeUndefined();
  });
});

describe("toAnthropicTools", () => {
  it("converts to Anthropic format with input_schema", () => {
    const tools = getAllTools();
    const anthropic = toAnthropicTools(tools);

    expect(anthropic.length).toBe(tools.length);
    for (const t of anthropic) {
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
      expect(t).toHaveProperty("input_schema");
      expect(t.input_schema.type).toBe("object");
    }
  });
});

describe("toOpenAITools", () => {
  it("converts to OpenAI format with function wrapper", () => {
    const tools = getAllTools();
    const openai = toOpenAITools(tools);

    expect(openai.length).toBe(tools.length);
    for (const t of openai) {
      expect(t.type).toBe("function");
      expect(t.function).toHaveProperty("name");
      expect(t.function).toHaveProperty("description");
      expect(t.function).toHaveProperty("parameters");
      expect(t.function.parameters.type).toBe("object");
    }
  });
});
