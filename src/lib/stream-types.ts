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
  | {
      /**
       * Measured context-window usage for one tool round, so the client can
       * render a usage meter and decide whether to auto-compact. Emitted once
       * per round (each tool call is another model call); the final round of a
       * turn reflects the fullest context. `usedTokens` is the real
       * `prompt_tokens` from the provider, not an estimate. `shouldCompact` is
       * the server's verdict (window stays server-only).
       */
      type: "context_usage";
      usedTokens: number;
      windowTokens: number;
      shouldCompact: boolean;
      /** Estimated fixed (uncompactable) overhead, for the usage breakdown:
       *  the paper block's footprint, and paper + system prompt combined. */
      paperTokens: number;
      overheadTokens: number;
    }
  | {
      type: "error";
      message: string;
      /** Set when the upstream provider rejected the turn for hitting a usage
       *  limit, so the client can surface an "add your own key" prompt rather
       *  than a generic failure. */
      code?: "rate_limit";
    }
  | { type: "done" };
