/**
 * Anthropic agentic loop — streams tool-augmented responses from Claude.
 */

import type { StreamEvent } from "@/lib/stream-types";
import { parseApiErrorMessage } from "@/lib/api-utils";
import { readSSEStream } from "@/lib/sse";
import type { ParsedPaper } from "@/lib/review-types";
import {
  getAllTools,
  getToolByName,
  toAnthropicTools,
} from "@/tools/registry";
import { BRAVE_KEY_REQUIRED_SENTINEL } from "@/tools/web-search";
import type { ToolContext } from "@/tools/types";
import { buildPaperBlock } from "./paper-block";

const MAX_TOOL_ROUNDS = 8;

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

/* ------------------------------------------------------------------ */
/*  Anthropic API types                                                */
/* ------------------------------------------------------------------ */

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicSSEEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
  message?: { usage?: AnthropicUsage };
  usage?: AnthropicUsage;
}

type AnthropicMessageContent = AnthropicContentBlock | AnthropicToolResultBlock;

type AnthropicCacheControl = { type: "ephemeral" };

interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: AnthropicCacheControl;
}

interface AnthropicToolWithCache {
  name: string;
  description: string;
  input_schema: unknown;
  cache_control?: AnthropicCacheControl;
}

export async function runAnthropicAgentLoop(
  chatMessages: { role: "user" | "assistant"; content: string }[],
  model: string,
  apiKey: string,
  systemPrompt: string,
  paperContext: string | undefined,
  parsedPaper: ParsedPaper | undefined,
  tools: ReturnType<typeof getAllTools>,
  toolContext: ToolContext,
  emit: (e: StreamEvent) => void,
) {
  // System is a structured array so we can mark the paper as a cache
  // breakpoint. The base prompt is small + stable; the paper is large + stable
  // across turns within a 5-minute window. Caching the paper is the win;
  // marking the base prompt as cacheable too is harmless and slightly cheaper.
  const systemBlocks: AnthropicSystemBlock[] = [
    { type: "text", text: systemPrompt },
  ];
  const paperBlock = buildPaperBlock(paperContext, parsedPaper);
  if (paperBlock) {
    systemBlocks.push({
      type: "text",
      text: paperBlock,
      cache_control: { type: "ephemeral" },
    });
  }

  // Tool definitions are stable across turns too. Mark the last tool as a
  // cache breakpoint so the entire tools array gets cached.
  const baseTools = toAnthropicTools(tools);
  const cachedTools: AnthropicToolWithCache[] = baseTools.length
    ? [
        ...baseTools.slice(0, -1),
        {
          ...baseTools[baseTools.length - 1],
          cache_control: { type: "ephemeral" },
        },
      ]
    : [];

  const apiMessages: Array<{ role: string; content: string | AnthropicMessageContent[] }> = chatMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    emit({ type: "turn_start" });

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 16384,
        system: systemBlocks,
        messages: apiMessages,
        tools: cachedTools,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(parseApiErrorMessage(errText, `Anthropic API error: ${response.status}`));
    }

    if (!response.body) throw new Error("No response body from Anthropic");

    const { contentBlocks, stopReason } = await parseAnthropicSSE(response.body, emit);

    if (stopReason !== "tool_use") break;

    const toolCalls = contentBlocks.filter(
      (b): b is AnthropicToolUseBlock => b.type === "tool_use",
    );
    if (toolCalls.length === 0) break;

    apiMessages.push({ role: "assistant", content: contentBlocks });

    const toolResults: AnthropicToolResultBlock[] = [];
    for (const tc of toolCalls) {
      emit({ type: "tool_call", id: tc.id, name: tc.name, input: tc.input });

      let output: string;
      try {
        const tool = getToolByName(tc.name);
        output = tool
          ? await tool.execute(tc.input, toolContext)
          : `Unknown tool "${tc.name}". Available tools: ${tools.map((t) => t.name).join(", ")}`;
      } catch (err) {
        output = `Tool error: ${err instanceof Error ? err.message : "unknown error"}`;
      }

      emit({ type: "tool_result", id: tc.id, name: tc.name, output });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: output,
      });
    }

    // If web_search returned the "no Brave key" sentinel, stop the loop
    // immediately. The chat UI will surface a configure card and pause until
    // the user adds a key or dismisses; otherwise the agent would charge
    // ahead with an answer it knows is unsupported by web grounding.
    if (
      toolResults.some((r) => r.content === BRAVE_KEY_REQUIRED_SENTINEL)
    ) {
      break;
    }

    apiMessages.push({ role: "user", content: toolResults });
  }
}

/* ------------------------------------------------------------------ */
/*  Anthropic SSE parser                                               */
/* ------------------------------------------------------------------ */

async function parseAnthropicSSE(
  body: ReadableStream<Uint8Array>,
  emit: (e: StreamEvent) => void,
): Promise<{ contentBlocks: AnthropicContentBlock[]; stopReason: string }> {
  const blocks: AnthropicContentBlock[] = [];
  let toolInputAccum = "";
  let stopReason = "end_turn";
  // Anthropic reports input/cache token counts on `message_start` and the
  // final output_tokens on `message_delta`. Accumulate both before emitting.
  const usage: AnthropicUsage = {};

  await readSSEStream<AnthropicSSEEvent>(body, (event) => {
    switch (event.type) {
      case "message_start": {
        const u = event.message?.usage;
        if (u) {
          if (u.input_tokens !== undefined) usage.input_tokens = u.input_tokens;
          if (u.cache_creation_input_tokens !== undefined)
            usage.cache_creation_input_tokens = u.cache_creation_input_tokens;
          if (u.cache_read_input_tokens !== undefined)
            usage.cache_read_input_tokens = u.cache_read_input_tokens;
          if (u.output_tokens !== undefined)
            usage.output_tokens = u.output_tokens;
        }
        break;
      }

      case "content_block_start": {
        const cb = event.content_block;
        if (!cb || event.index === undefined) break;
        if (cb.type === "text") {
          blocks[event.index] = { type: "text", text: "" };
        } else if (cb.type === "tool_use" && cb.id && cb.name) {
          blocks[event.index] = {
            type: "tool_use",
            id: cb.id,
            name: cb.name,
            input: {},
          };
          toolInputAccum = "";
        }
        break;
      }

      case "content_block_delta": {
        const idx = event.index;
        const delta = event.delta;
        if (idx === undefined || !delta) break;
        const block = blocks[idx];
        if (delta.type === "text_delta" && block?.type === "text" && delta.text) {
          block.text += delta.text;
          emit({ type: "text_delta", text: delta.text });
        } else if (delta.type === "input_json_delta" && block?.type === "tool_use" && delta.partial_json) {
          toolInputAccum += delta.partial_json;
        }
        break;
      }

      case "content_block_stop": {
        const idx = event.index;
        if (idx === undefined) break;
        const block = blocks[idx];
        if (block?.type === "tool_use" && toolInputAccum) {
          try {
            block.input = JSON.parse(toolInputAccum);
          } catch {
            block.input = {};
          }
          toolInputAccum = "";
        }
        break;
      }

      case "message_delta": {
        if (event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
        // Final output_tokens (and sometimes updated input counts) ride on
        // message_delta; merge into the running usage record.
        const u = event.usage;
        if (u) {
          if (u.input_tokens !== undefined) usage.input_tokens = u.input_tokens;
          if (u.cache_creation_input_tokens !== undefined)
            usage.cache_creation_input_tokens = u.cache_creation_input_tokens;
          if (u.cache_read_input_tokens !== undefined)
            usage.cache_read_input_tokens = u.cache_read_input_tokens;
          if (u.output_tokens !== undefined)
            usage.output_tokens = u.output_tokens;
        }
        break;
      }
    }
  });

  emit({
    type: "cache_stats",
    inputTokens: usage.input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  });

  return { contentBlocks: blocks, stopReason };
}
