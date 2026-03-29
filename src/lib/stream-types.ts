/**
 * NDJSON event types shared between the chat API route and client-side
 * stream parser.  Single source of truth — both sides import from here.
 */

/** An event emitted over the NDJSON chat stream. */
export type StreamEvent =
  | { type: "turn_start" }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; output: string }
  | { type: "error"; message: string }
  | { type: "done" };
