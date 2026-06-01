/**
 * OpenAI-compatible agentic loop — works with OpenAI, xAI, and any
 * OpenAI-compatible inference provider (e.g. Fireworks, OpenRouter).
 * The round/watchdog/tool-execution logic lives in `agent-loop.ts`; this
 * file is the OpenAI-specific adapter (HTTP call, SSE parser, tool/role
 * message format).
 */

import type { StreamEvent } from "@/lib/stream-types";
import { parseApiErrorMessage } from "@/lib/api-utils";
import { readSSEStream } from "@/lib/sse";
import type { ParsedPaper } from "@/lib/review-types";
import {
  openAiCompatibleChatCompletionsUrl,
  openAiMaxTokensField,
  providerApiErrorLabel,
  type OpenAiCompatibleProvider,
} from "@/lib/ai-providers";
import { toOpenAITools } from "@/tools/registry";
import type { ToolContext, ToolDefinition } from "@/tools/types";
import { toOpenAIMessages, type TranscriptMessage } from "@/lib/transcript";
import { buildPaperBlock } from "./paper-block";
import {
  runAgentLoop,
  TOOL_RESULT_GUARDRAIL,
  type NormalizedToolCall,
  type ProviderAdapter,
  type ToolOutput,
  type TurnResult,
} from "./agent-loop";

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

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface OpenAIStreamEvent {
  choices?: OpenAIStreamChoice[];
  usage?: OpenAIUsage;
}

export interface OpenAIHandlerOptions {
  /** Custom OpenAI-compatible base URL. */
  customOpenAiBaseUrl?: string | null;
  /** Whether the provider supports streaming. Default: true. */
  supportsStreaming?: boolean;
}

export async function runOpenAIAgentLoop(
  chatMessages: TranscriptMessage[],
  model: string,
  apiKey: string,
  systemPrompt: string,
  paperContext: string | undefined,
  parsedPaper: ParsedPaper | undefined,
  provider: OpenAiCompatibleProvider,
  tools: ToolDefinition[],
  toolContext: ToolContext,
  emit: (e: StreamEvent) => void,
  options?: OpenAIHandlerOptions,
) {
  const useStreaming = options?.supportsStreaming !== false;
  const paperBlock = buildPaperBlock(paperContext, parsedPaper);
  const baseSystem = systemPrompt + TOOL_RESULT_GUARDRAIL;
  const systemContent = paperBlock ? `${baseSystem}\n\n${paperBlock}` : baseSystem;

  const openaiTools = toOpenAITools(tools);
  const baseUrl = openAiCompatibleChatCompletionsUrl(provider, options?.customOpenAiBaseUrl);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // Seed from the normalized transcript so prior tool work replays as real
  // assistant `tool_calls` + `tool` messages, not just past answer text. The
  // live loop appends new turns below in the same shapes.
  const apiMessages: Array<Record<string, unknown>> = [
    { role: "system", content: systemContent },
    ...toOpenAIMessages(chatMessages),
  ];

  // Hold the latest turn's raw tool calls so appendAssistantTurn can persist
  // them in OpenAI's native shape with the original arguments string.
  let lastTextContent = "";
  let lastRawToolCalls: OpenAIToolCall[] = [];

  const adapter: ProviderAdapter = {
    async request(): Promise<TurnResult> {
      const requestBody: Record<string, unknown> = {
        model,
        messages: apiMessages,
        tools: openaiTools,
        stream: useStreaming,
        ...openAiMaxTokensField(model, 16384),
      };
      // OpenAI/xAI: opt into usage in the final stream chunk so we can report
      // cached_tokens uniformly. Local OpenAI-compatible servers that don't
      // recognize this option typically ignore it; if any reject it, we'd need
      // a capability flag, but at present this is universally accepted.
      if (useStreaming) {
        requestBody.stream_options = { include_usage: true };
      }

      const response = await fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errText = await response.text();
        const label = providerApiErrorLabel(provider);
        throw new Error(parseApiErrorMessage(errText, `${label} API error: ${response.status}`));
      }

      let textContent: string;
      let rawToolCalls: OpenAIToolCall[];
      let finishReason: string;
      let usage: OpenAIUsage | undefined;

      if (!useStreaming) {
        const data = (await response.json()) as {
          choices?: Array<{
            finish_reason?: string;
            message?: { content?: string; tool_calls?: OpenAIToolCall[] };
          }>;
          usage?: OpenAIUsage;
        };
        const choice = data.choices?.[0];
        textContent = choice?.message?.content ?? "";
        rawToolCalls = choice?.message?.tool_calls ?? [];
        finishReason = choice?.finish_reason ?? "stop";
        usage = data.usage;

        if (textContent) {
          emit({ type: "text_delta", text: textContent });
        }
      } else {
        if (!response.body) {
          throw new Error(`No response body from ${providerApiErrorLabel(provider)}`);
        }
        const parsed = await parseOpenAISSE(response.body, emit);
        textContent = parsed.textContent;
        rawToolCalls = parsed.toolCalls;
        finishReason = parsed.finishReason;
        usage = parsed.usage;
      }

      if (usage) {
        const promptTokens = usage.prompt_tokens ?? 0;
        const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
        emit({
          type: "cache_stats",
          // OpenAI reports the *total* prompt_tokens including the cached
          // portion. Surface non-cached input separately so the event has the
          // same meaning as for Anthropic.
          inputTokens: Math.max(0, promptTokens - cached),
          cacheReadTokens: cached,
          cacheCreationTokens: 0, // OpenAI auto-caches; no creation accounting.
          outputTokens: usage.completion_tokens ?? 0,
        });
      }

      lastTextContent = textContent;
      lastRawToolCalls = rawToolCalls;

      const toolCalls: NormalizedToolCall[] = rawToolCalls.map((tc) => {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          input = {};
        }
        return { id: tc.id, name: tc.function.name, input };
      });

      return {
        toolCalls,
        textContent,
        isEmpty: !textContent.trim() && rawToolCalls.length === 0,
        isToolStop: finishReason === "tool_calls" && rawToolCalls.length > 0,
      };
    },

    appendAssistantTurn() {
      // Skip empty turns (watchdog path with no text and no tool_calls):
      // OpenAI rejects assistant messages with neither content nor tool_calls.
      if (!lastTextContent && lastRawToolCalls.length === 0) return;
      const message: Record<string, unknown> = {
        role: "assistant",
        content: lastTextContent || null,
      };
      if (lastRawToolCalls.length > 0) {
        message.tool_calls = lastRawToolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
      }
      apiMessages.push(message);
    },

    appendToolResults(outputs: ToolOutput[]) {
      for (const o of outputs) {
        apiMessages.push({
          role: "tool",
          tool_call_id: o.id,
          content: o.wrapped,
        });
      }
    },

    appendUserNudge(content: string) {
      apiMessages.push({ role: "user", content });
    },

    hasPriorToolResults() {
      return apiMessages.some((m) => m.role === "tool");
    },
  };

  await runAgentLoop(adapter, tools, toolContext, emit);
}

/* ------------------------------------------------------------------ */
/*  OpenAI SSE parser                                                  */
/* ------------------------------------------------------------------ */

async function parseOpenAISSE(
  body: ReadableStream<Uint8Array>,
  emit: (e: StreamEvent) => void,
): Promise<{
  textContent: string;
  toolCalls: OpenAIToolCall[];
  finishReason: string;
  usage?: OpenAIUsage;
}> {
  let textContent = "";
  const toolCallMap = new Map<number, OpenAIToolCall>();
  let finishReason = "stop";
  let usage: OpenAIUsage | undefined;

  await readSSEStream<OpenAIStreamEvent>(body, (event) => {
    // Final chunk: choices is empty array, usage is populated. Capture it
    // and bail before scanning choices below.
    if (event.usage) {
      usage = event.usage;
    }

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
  return { textContent, toolCalls, finishReason, usage };
}
