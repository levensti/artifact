/**
 * Tool registry — collects all tool definitions and provides helpers
 * to convert them to provider-specific formats (Anthropic, OpenAI).
 *
 * To register a new tool, import it here and add it to ALL_TOOLS.
 */

import type { ToolDefinition } from "./types";
import { arxivSearchTool } from "./arxiv-search";
import { webSearchTool } from "./web-search";
import { rankResultsTool } from "./rank-results";
import { saveToGraphTool } from "./save-to-graph";

/* ------------------------------------------------------------------ */
/*  Register tools here                                                */
/* ------------------------------------------------------------------ */

const ALL_TOOLS: ToolDefinition[] = [
  arxivSearchTool,
  webSearchTool,
  rankResultsTool,
  saveToGraphTool,
];

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function getAllTools(): ToolDefinition[] {
  return ALL_TOOLS;
}

export function getToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: ToolDefinition["parameters"];
}

export interface OpenAIToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolDefinition["parameters"];
  };
}

/** Convert to Anthropic /v1/messages `tools` format. */
export function toAnthropicTools(tools: ToolDefinition[]): AnthropicToolSchema[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/** Convert to OpenAI /chat/completions `tools` format. */
export function toOpenAITools(tools: ToolDefinition[]): OpenAIToolSchema[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
