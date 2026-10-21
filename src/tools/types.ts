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
  /** Item schema for `array`-typed properties. Recursive so arrays of
   *  objects (with their own nested `properties` + `required`) work. */
  items?: ToolParameterProperty;
  /** Nested properties for `object`-typed items. */
  properties?: Record<string, ToolParameterProperty>;
  /** Required keys for `object`-typed items. */
  required?: string[];
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
  /** Title of the current paper. */
  paperTitle?: string;
  /** arXiv ID of the current paper (if applicable). */
  arxivId?: string;
  /** Internal review ID for data persistence. */
  reviewId?: string;
  /**
   * User-provided Exa API key. When present, `web_search` uses this;
   * otherwise the tool returns a sentinel and the UI prompts for a key.
   */
  exaApiKey?: string;
  /**
   * Vector search over the document's chunk index, when the document is
   * indexed; `search_paper` is registered only when it's present.
   * Supplied by the chat route (which has the DB).
   */
  searchChunks?: (
    query: string,
    k: number,
  ) => Promise<import("@/lib/documents").ChunkHit[]>;
  /**
   * The review's artifacts, bound to the signed-in user by the chat route;
   * the artifact tools are registered only when it's present.
   */
  artifacts?: ArtifactStore;
}

/** What the artifact tools can do to the review's artifacts. */
export interface ArtifactStore {
  create(
    content: import("@/lib/artifacts").ArtifactContent,
    sourceCallId: string,
  ): Promise<import("@/lib/artifacts").ArtifactRef>;
  /** Current version, or null when the id isn't one of this review's. */
  current(
    id: string,
  ): Promise<
    (import("@/lib/artifacts").ArtifactContent & { version: number }) | null
  >;
  append(
    id: string,
    change: {
      html: string;
      changeSummary: string;
      sourceCallId: string;
      title?: string;
      summary?: string;
    },
  ): Promise<import("@/lib/artifacts").ArtifactRef>;
}

/* ------------------------------------------------------------------ */
/*  Tool definition — the contract every tool file implements          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Tool result — structured return value from a tool                  */
/* ------------------------------------------------------------------ */

/**
 * Out-of-band control signal a tool can raise on its result. The agent loop
 * branches on this generically instead of string-matching tool output.
 *
 * - `needs_user_input`: the tool can't proceed until the user supplies
 *   something (e.g. `web_search` with no Exa key). The loop pauses the round
 *   when nothing else usable came back, and the `content` is fed to the model
 *   and UI verbatim (not wrapped) so both recognize the literal signal.
 */
export type ToolControl = "needs_user_input";

/**
 * A tool's return value. Tools may return a bare string (treated as a
 * successful result) or this richer shape when they need to report failure or
 * raise a control signal. Keeping `ok` on the result is what lets the loop
 * decide "did this round produce anything usable?" without a brittle
 * failure-string regex.
 */
export interface ToolResult {
  /** Text fed back to the model (and emitted to the UI as the tool_result). */
  content: string;
  /** Did the tool produce a usable result? Defaults to `true`. A `false`
   *  marks errors / empty results so the loop doesn't count them as progress. */
  ok?: boolean;
  /** Optional out-of-band signal — see {@link ToolControl}. */
  control?: ToolControl;
}

/** A tool result with defaults applied — what the loop actually consumes. */
export interface NormalizedToolResult {
  content: string;
  ok: boolean;
  control?: ToolControl;
}

/** Coerce a tool's `string | ToolResult` return into a uniform shape. A bare
 *  string is a success; an object's `ok` defaults to `true`. */
export function normalizeToolResult(
  result: string | ToolResult,
): NormalizedToolResult {
  if (typeof result === "string") return { content: result, ok: true };
  return { content: result.content, ok: result.ok ?? true, control: result.control };
}

export interface ToolDefinition {
  /** Unique snake_case name (sent to the LLM as the tool name). */
  name: string;
  /** One-paragraph description the LLM sees to decide when to call this tool. */
  description: string;
  /** JSON-Schema-style parameter spec. */
  parameters: ToolParameters;
  /**
   * Execute the tool with validated input. Return a bare string for a normal
   * successful result, or a {@link ToolResult} to report failure (`ok: false`)
   * or raise a control signal. The returned text is fed back into the LLM
   * conversation.
   */
  execute: (
    input: Record<string, unknown>,
    context: ToolContext,
    /** The model's tool call, for tools that key writes on its id. */
    call?: { id: string },
  ) => Promise<string | ToolResult>;
}
