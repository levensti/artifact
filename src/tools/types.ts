/**
 * Tool system types.
 *
 * Every tool lives in its own file under src/tools/ and exports a single
 * `ToolDefinition`. The registry (registry.ts) collects them and converts
 * to the format each LLM provider expects.
 *
 * To add a new tool:
 *   1. Create a new file in src/tools/ (e.g. my-tool.ts)
 *   2. Export a `ToolDefinition` as the default or named export
 *   3. Import and add it to the `ALL_TOOLS` array in registry.ts
 */

/* ------------------------------------------------------------------ */
/*  JSON Schema subset used for tool parameter definitions             */
/* ------------------------------------------------------------------ */

export interface ToolParameterProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: string[];
  items?: { type: string };
  default?: unknown;
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

/* ------------------------------------------------------------------ */
/*  Context passed to every tool at execution time                     */
/* ------------------------------------------------------------------ */

export interface ToolContext {
  /** Full text of the paper being reviewed (may be empty if PDF not yet parsed). */
  paperContext?: string;
  /** Title of the current paper. */
  paperTitle?: string;
  /** arXiv ID of the current paper (if applicable). */
  arxivId?: string;
  /** Internal review ID for data persistence. */
  reviewId?: string;
  /**
   * Structured representation of the paper, when available. Used by
   * paper-internal tools (read_section, search_paper, lookup_citation)
   * to access the paper without dragging the full text into every prompt.
   * Populated by the chat handler from the request body.
   */
  parsedPaper?: import("@/lib/review-types").ParsedPaper;
  /**
   * User-provided Brave Search API key. When present, `web_search` uses
   * this; otherwise the tool isn't registered for the request at all.
   */
  braveSearchApiKey?: string;
}

/* ------------------------------------------------------------------ */
/*  Tool definition — the contract every tool file implements          */
/* ------------------------------------------------------------------ */

export interface ToolDefinition {
  /** Unique snake_case name (sent to the LLM as the tool name). */
  name: string;
  /** One-paragraph description the LLM sees to decide when to call this tool. */
  description: string;
  /** JSON-Schema-style parameter spec. */
  parameters: ToolParameters;
  /**
   * Execute the tool with validated input and return a text result
   * that gets fed back into the LLM conversation.
   */
  execute: (
    input: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<string>;
}
