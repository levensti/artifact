/**
 * OpenRouter agentic loop. OpenRouter speaks the OpenAI Chat Completions
 * shape, so this is the OpenAI-compatible adapter — HTTP call, SSE parser,
 * tool/role message format. The round/watchdog/tool-execution logic lives in
 * `agent-loop.ts`; this file just supplies a `ProviderAdapter`.
 */

import type { StreamEvent } from "@/lib/stream-types";
import { parseApiErrorMessage } from "@/lib/api-utils";
import { readSSEStream } from "@/lib/sse";
import type { ParsedPaper } from "@/lib/review-types";
import {
  OPENROUTER_BASE_URL,
  OPENROUTER_MODEL,
  type OpenRouterUsage,
} from "@/lib/openrouter";
import { toOpenAITools } from "@/tools/registry";
import type { ToolContext, ToolDefinition } from "@/tools/types";
import { toOpenAIMessages, type TranscriptMessage } from "@/lib/transcript";
import { buildPaperBlock } from "./paper-block";
import {
  runAgentLoop,
  TOOL_RESULT_GUARDRAIL,
  type AgentLoopOptions,
  type NormalizedToolCall,
  type ProviderAdapter,
  type ToolOutput,
  type TurnResult,
} from "./agent-loop";

const OPENROUTER_CHAT_COMPLETIONS_URL = `${OPENROUTER_BASE_URL}/chat/completions`;

/* ------------------------------------------------------------------ */
/*  OpenAI-compatible API types                                        */
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
  usage?: OpenRouterUsage;
}

export async function runOpenRouterAgentLoop(
  chatMessages: TranscriptMessage[],
  apiKey: string,
  systemPrompt: string,
  paperContext: string | undefined,
  parsedPaper: ParsedPaper | undefined,
  tools: ToolDefinition[],
  toolContext: ToolContext,
  emit: (e: StreamEvent) => void,
  options?: AgentLoopOptions,
  model = OPENROUTER_MODEL,
) {
  const paperBlock = buildPaperBlock(paperContext, parsedPaper);
  const baseSystem = systemPrompt + TOOL_RESULT_GUARDRAIL;
  const systemContent = paperBlock ? `${baseSystem}\n\n${paperBlock}` : baseSystem;

  const openaiTools = toOpenAITools(tools);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // Seed from the normalized transcript so prior tool work replays as real
  // assistant `tool_calls` + `tool` messages, not just past answer text. The
  // live loop appends new turns below in the same shapes. A trailing system
  // reminder (when configured) lands after the history so its rules carry
  // recency over the model's own earlier turns.
  const apiMessages: Array<Record<string, unknown>> = [
    { role: "system", content: systemContent },
    ...toOpenAIMessages(chatMessages),
    ...(options?.trailingSystemReminder
      ? [{ role: "system", content: options.trailingSystemReminder }]
      : []),
  ];

  // Hold the latest turn's raw tool calls so appendAssistantTurn can persist
  // them in OpenAI's native shape with the original arguments string.
  let lastTextContent = "";
  let lastRawToolCalls: OpenAIToolCall[] = [];

  const adapter: ProviderAdapter = {
    async request(): Promise<TurnResult> {
      const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: apiMessages,
          tools: openaiTools,
          stream: true,
          max_tokens: 16384,
          // Opt into usage in the final stream chunk so we can report
          // cached_tokens uniformly.
          stream_options: { include_usage: true },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        const err = new Error(
          parseApiErrorMessage(errText, `OpenRouter API error: ${response.status}`),
        );
        // Tag rate-limit (429) so the client can prompt for the user's own key
        // instead of showing a generic error. 402 = out of credits behaves the
        // same from the user's standpoint (the platform allowance is spent).
        if (response.status === 429 || response.status === 402) {
          (err as { isRateLimit?: boolean }).isRateLimit = true;
        }
        throw err;
      }
      if (!response.body) throw new Error("No response body from OpenRouter");

      const parsed = await parseOpenAISSE(response.body, emit);
      const { textContent, toolCalls: rawToolCalls, finishReason, usage } = parsed;

      if (usage) {
        const promptTokens = usage.prompt_tokens ?? 0;
        const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
        emit({
          type: "cache_stats",
          // OpenRouter reports the *total* prompt_tokens including the cached
          // portion. Surface non-cached input separately.
          inputTokens: Math.max(0, promptTokens - cached),
          cacheReadTokens: cached,
          cacheCreationTokens: 0,
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
      // the API rejects assistant messages with neither content nor tool_calls.
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

  await runAgentLoop(adapter, tools, toolContext, emit, options);
}

/* ------------------------------------------------------------------ */
/*  OpenAI-compatible SSE parser                                       */
/* ------------------------------------------------------------------ */

async function parseOpenAISSE(
  body: ReadableStream<Uint8Array>,
  emit: (e: StreamEvent) => void,
): Promise<{
  textContent: string;
  toolCalls: OpenAIToolCall[];
  finishReason: string;
  usage?: OpenRouterUsage;
}> {
  let textContent = "";
  const toolCallMap = new Map<number, OpenAIToolCall>();
  let finishReason = "stop";
  let usage: OpenRouterUsage | undefined;

  await readSSEStream<OpenAIStreamEvent>(body, (event) => {
    // Final chunk: choices is empty array, usage is populated.
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
