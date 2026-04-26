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
  | {
      /**
       * Token usage from the model API for one tool round. Reported uniformly
       * across providers; fields the provider doesn't supply are zero.
       *  - inputTokens: non-cached input tokens billed at full rate
       *  - cacheReadTokens: input tokens served from cache (~10% rate)
       *  - cacheCreationTokens: input tokens written to cache (Anthropic only)
       *  - outputTokens: generated tokens billed at output rate
       */
      type: "cache_stats";
      inputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      outputTokens: number;
    }
  | { type: "error"; message: string }
  | { type: "done" };
