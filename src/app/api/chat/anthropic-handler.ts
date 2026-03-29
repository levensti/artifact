/**
 * Anthropic agentic loop — streams tool-augmented responses from Claude.
 */

import type { StreamEvent } from "@/lib/stream-types";
import {
  getAllTools,
  getToolByName,
  toAnthropicTools,
} from "@/tools/registry";
import type { ToolContext } from "@/tools/types";

const MAX_TOOL_ROUNDS = 8;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnthropicContent = any;

interface AnthropicToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiMessages: any[] = chatMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    emit({ type: "turn_start" });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
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
      let msg = `Anthropic API error: ${response.status}`;
      try { msg = JSON.parse(errText).error?.message || msg; } catch { /* ok */ }
      throw new Error(msg);
    }

    if (!response.body) throw new Error("No response body from Anthropic");

    const { contentBlocks, stopReason } = await parseAnthropicSSE(response.body, emit);

    if (stopReason !== "tool_use") break;

    const toolCalls = contentBlocks.filter(
      (b): b is { type: "tool_use" } & AnthropicToolCall => b.type === "tool_use",
    );
    if (toolCalls.length === 0) break;

    apiMessages.push({ role: "assistant", content: contentBlocks });

    const toolResults: AnthropicContent[] = [];
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
): Promise<{ contentBlocks: AnthropicContent[]; stopReason: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const blocks: AnthropicContent[] = [];
  let toolInputAccum = "";
  let stopReason = "end_turn";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        let event: Record<string, AnthropicContent>;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        switch (event.type) {
          case "content_block_start": {
            const cb = event.content_block;
            if (cb.type === "text") {
              blocks[event.index] = { type: "text", text: "" };
            } else if (cb.type === "tool_use") {
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
            if (delta.type === "text_delta" && blocks[idx]?.type === "text") {
              blocks[idx].text += delta.text;
              emit({ type: "text_delta", text: delta.text });
            } else if (delta.type === "input_json_delta" && blocks[idx]?.type === "tool_use") {
              toolInputAccum += delta.partial_json;
            }
            break;
          }

          case "content_block_stop": {
            const idx = event.index;
            if (blocks[idx]?.type === "tool_use" && toolInputAccum) {
              try {
                blocks[idx].input = JSON.parse(toolInputAccum);
              } catch {
                blocks[idx].input = {};
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
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { contentBlocks: blocks, stopReason };
}
