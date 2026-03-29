/**
 * OpenAI-compatible agentic loop — works with OpenAI, xAI, and OpenRouter.
 */

import type { StreamEvent } from "@/lib/stream-types";
import { parseApiErrorMessage } from "@/lib/api-utils";
import {
  openAiCompatibleChatCompletionsUrl,
  OPENROUTER_APP_TITLE,
  OPENROUTER_HTTP_REFERER,
  providerApiErrorLabel,
  type OpenAiCompatibleProvider,
} from "@/lib/ai-providers";
import {
  getAllTools,
  getToolByName,
  toOpenAITools,
} from "@/tools/registry";
import type { ToolContext } from "@/tools/types";

const MAX_TOOL_ROUNDS = 8;

/* ------------------------------------------------------------------ */
/*  OpenAI API types                                                   */
/* ------------------------------------------------------------------ */

interface OpenAIToolCall {
  index: number;
  id: string;
  function: { name: string; arguments: string };
}

interface OpenAIStreamDelta {
  content?: string;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface OpenAIStreamChoice {
  finish_reason?: string;
  delta?: OpenAIStreamDelta;
}

interface OpenAIStreamEvent {
  choices?: OpenAIStreamChoice[];
}

export async function runOpenAIAgentLoop(
  chatMessages: { role: "user" | "assistant"; content: string }[],
  model: string,
  apiKey: string,
  systemPrompt: string,
  paperContext: string | undefined,
  provider: OpenAiCompatibleProvider,
  tools: ReturnType<typeof getAllTools>,
  toolContext: ToolContext,
  emit: (e: StreamEvent) => void,
) {
  const systemContent = paperContext
    ? `${systemPrompt}\n\n<paper>\n${paperContext}\n</paper>`
    : systemPrompt;

  const openaiTools = toOpenAITools(tools);
  const baseUrl = openAiCompatibleChatCompletionsUrl(provider);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = OPENROUTER_HTTP_REFERER;
    headers["X-Title"] = OPENROUTER_APP_TITLE;
  }

  const apiMessages: Array<Record<string, unknown>> = [
    { role: "system", content: systemContent },
    ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    emit({ type: "turn_start" });

    const response = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: apiMessages,
        tools: openaiTools,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      const label = providerApiErrorLabel(provider);
      throw new Error(parseApiErrorMessage(errText, `${label} API error: ${response.status}`));
    }

    if (!response.body) {
      throw new Error(`No response body from ${providerApiErrorLabel(provider)}`);
    }

    const { textContent, toolCalls, finishReason } = await parseOpenAISSE(
      response.body, emit,
    );

    if (finishReason !== "tool_calls" || toolCalls.length === 0) break;

    apiMessages.push({
      role: "assistant",
      content: textContent || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    });

    for (const tc of toolCalls) {
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(tc.function.arguments);
      } catch { /* empty */ }

      emit({ type: "tool_call", id: tc.id, name: tc.function.name, input: parsedInput });

      let output: string;
      try {
        const tool = getToolByName(tc.function.name);
        output = tool
          ? await tool.execute(parsedInput, toolContext)
          : `Unknown tool "${tc.function.name}".`;
      } catch (err) {
        output = `Tool error: ${err instanceof Error ? err.message : "unknown error"}`;
      }

      emit({ type: "tool_result", id: tc.id, name: tc.function.name, output });
      apiMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: output,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  OpenAI SSE parser                                                  */
/* ------------------------------------------------------------------ */

async function parseOpenAISSE(
  body: ReadableStream<Uint8Array>,
  emit: (e: StreamEvent) => void,
): Promise<{ textContent: string; toolCalls: OpenAIToolCall[]; finishReason: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let textContent = "";
  const toolCallMap = new Map<number, OpenAIToolCall>();
  let finishReason = "stop";

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

        let event: OpenAIStreamEvent;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        const choice = event.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        const delta = choice.delta;
        if (!delta) continue;

        if (delta.content) {
          textContent += delta.content;
          emit({ type: "text_delta", text: delta.content });
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallMap.has(idx)) {
              toolCallMap.set(idx, {
                index: idx,
                id: tc.id ?? "",
                function: { name: tc.function?.name ?? "", arguments: "" },
              });
            }
            const existing = toolCallMap.get(idx)!;
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.function.name = tc.function.name;
            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const toolCalls = Array.from(toolCallMap.values()).sort((a, b) => a.index - b.index);
  return { textContent, toolCalls, finishReason };
}
