/**
 * OpenAI-compatible agentic loop — works with OpenAI, xAI, and any
 * OpenAI-compatible inference provider (e.g. Fireworks, OpenRouter).
 */

import type { StreamEvent } from "@/lib/stream-types";
import { parseApiErrorMessage } from "@/lib/api-utils";
import { readSSEStream } from "@/lib/sse";
import {
  openAiCompatibleChatCompletionsUrl,
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

export interface OpenAIHandlerOptions {
  /** Custom OpenAI-compatible base URL. */
  customOpenAiBaseUrl?: string | null;
  /** Whether the provider supports streaming. Default: true. */
  supportsStreaming?: boolean;
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
  options?: OpenAIHandlerOptions,
) {
  const useStreaming = options?.supportsStreaming !== false;
  const systemContent = paperContext
    ? `${systemPrompt}\n\n<paper>\n${paperContext}\n</paper>`
    : systemPrompt;

  const openaiTools = toOpenAITools(tools);
  const baseUrl = openAiCompatibleChatCompletionsUrl(provider, options?.customOpenAiBaseUrl);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

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
        stream: useStreaming,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      const label = providerApiErrorLabel(provider);
      throw new Error(parseApiErrorMessage(errText, `${label} API error: ${response.status}`));
    }

    let textContent: string;
    let toolCalls: OpenAIToolCall[];
    let finishReason: string;

    if (!useStreaming) {
      const data = (await response.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: string; tool_calls?: OpenAIToolCall[] };
        }>;
      };
      const choice = data.choices?.[0];
      textContent = choice?.message?.content ?? "";
      toolCalls = choice?.message?.tool_calls ?? [];
      finishReason = choice?.finish_reason ?? "stop";

      if (textContent) {
        emit({ type: "text_delta", text: textContent });
      }
    } else {
      if (!response.body) {
        throw new Error(`No response body from ${providerApiErrorLabel(provider)}`);
      }

      const parsed = await parseOpenAISSE(response.body, emit);
      textContent = parsed.textContent;
      toolCalls = parsed.toolCalls;
      finishReason = parsed.finishReason;
    }

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
  let textContent = "";
  const toolCallMap = new Map<number, OpenAIToolCall>();
  let finishReason = "stop";

  await readSSEStream<OpenAIStreamEvent>(body, (event) => {
    const choice = event.choices?.[0];
    if (!choice) return;

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }

    const delta = choice.delta;
    if (!delta) return;

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
  });

  const toolCalls = Array.from(toolCallMap.values()).sort((a, b) => a.index - b.index);
  return { textContent, toolCalls, finishReason };
}
