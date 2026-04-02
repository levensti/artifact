/**
 * Anthropic agentic loop — streams tool-augmented responses from Claude.
 */

import type { StreamEvent } from "@/lib/stream-types";
import { parseApiErrorMessage } from "@/lib/api-utils";
import { readSSEStream } from "@/lib/sse";
import {
  getAllTools,
  getToolByName,
  toAnthropicTools,
} from "@/tools/registry";
import type { ToolContext } from "@/tools/types";

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

interface AnthropicSSEEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
}

type AnthropicMessageContent = AnthropicContentBlock | AnthropicToolResultBlock;

export async function runAnthropicAgentLoop(
  chatMessages: { role: "user" | "assistant"; content: string }[],
  model: string,
  apiKey: string,
  systemPrompt: string,
  paperContext: string | undefined,
  tools: ReturnType<typeof getAllTools>,
  toolContext: ToolContext,
  emit: (e: StreamEvent) => void,
) {
  const systemContent = paperContext
    ? `${systemPrompt}\n\n<paper>\n${paperContext}\n</paper>`
    : systemPrompt;

  const anthropicTools = toAnthropicTools(tools);

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
        max_tokens: 4096,
        system: systemContent,
        messages: apiMessages,
        tools: anthropicTools,
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

  await readSSEStream<AnthropicSSEEvent>(body, (event) => {
    switch (event.type) {
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
        break;
      }
    }
  });

  return { contentBlocks: blocks, stopReason };
}
