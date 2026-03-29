/**
 * Agentic chat endpoint.
 *
 * Implements a server-side ReAct loop: the LLM can call tools (arXiv search,
 * web search, ranking, etc.) as many times as needed, and the loop feeds
 * results back until the LLM produces a final text response.
 *
 * Streams NDJSON events to the client:
 *   {"type":"text_delta","text":"..."}
 *   {"type":"tool_call","id":"...","name":"...","input":{...}}
 *   {"type":"tool_result","id":"...","name":"...","output":"..."}
 *   {"type":"error","message":"..."}
 *   {"type":"done"}
 */

import { NextRequest } from "next/server";
import type { Provider } from "@/lib/models";
import {
  invalidApiProviderMessage,
  isProvider,
  openAiCompatibleChatCompletionsUrl,
  OPENROUTER_APP_TITLE,
  OPENROUTER_HTTP_REFERER,
  providerApiErrorLabel,
  type OpenAiCompatibleProvider,
} from "@/lib/ai-providers";
import {
  getAllTools,
  getToolByName,
  toAnthropicTools,
  toOpenAITools,
} from "@/tools/registry";
import type { ToolContext } from "@/tools/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  provider: Provider;
  apiKey: string;
  paperContext?: string;
  paperTitle?: string;
  arxivId?: string;
  reviewId?: string;
}

/** NDJSON event streamed to the client. */
type StreamEvent =
  | { type: "turn_start" }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; output: string }
  | { type: "error"; message: string }
  | { type: "done" };

/** Maximum agentic loop iterations (tool calls before we force a text response). */
const MAX_TOOL_ROUNDS = 8;

/* ------------------------------------------------------------------ */
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are a superintelligent research assistant embedded in a paper reading tool. You have deep expertise across all academic fields — machine learning, mathematics, physics, biology, and beyond.

Your mission: help the user deeply understand the paper they are reading and the ideas surrounding it. You can explain, search, discover, and connect ideas.

Capabilities:
- You have the full text of the paper in context (when available)
- You can search arXiv to find related papers, prerequisites, and seminal references
- You can search the web to ground your answers with real sources and documentation
- You can rank and filter search results to find the most relevant ones

Guidelines:
- Cite specific sections, equations, figures, or theorems from the paper when relevant
- Use LaTeX notation for math (wrapped in $ or $$)
- When asked about prerequisites, related work, or the research landscape, proactively use your search tools to find real papers — don't just rely on your training data
- When explaining highly technical concepts, consider searching for authoritative explanations to ground your answer
- Be precise and dense with insight — researchers value depth over verbosity
- When you find relevant papers via search, include arXiv links (https://arxiv.org/abs/ID)
- Use tools when they add value, but don't force tool use for simple questions you can answer directly from the paper context`;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { messages, model, provider, apiKey, paperContext, paperTitle, arxivId, reviewId } = body;

  if (!apiKey || typeof apiKey !== "string") {
    return jsonError("API key is required.", 401);
  }
  if (!isProvider(provider)) {
    return jsonError(invalidApiProviderMessage(), 400);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError("Messages array is required and must not be empty.", 400);
  }
  if (!model || typeof model !== "string") {
    return jsonError("Model ID is required.", 400);
  }

  const tools = getAllTools();
  const toolContext: ToolContext = { paperContext, paperTitle, arxivId, reviewId };
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* controller may be closed */
        }
      };

      try {
        if (provider === "anthropic") {
          await runAnthropicAgentLoop(
            messages, model, apiKey, paperContext, tools, toolContext, emit,
          );
        } else {
          await runOpenAIAgentLoop(
            messages, model, apiKey, paperContext, provider as OpenAiCompatibleProvider,
            tools, toolContext, emit,
          );
        }
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }

      emit({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}

/* ================================================================== */
/*  Anthropic agentic loop                                             */
/* ================================================================== */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnthropicContent = any;

interface AnthropicToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

async function runAnthropicAgentLoop(
  chatMessages: ChatMessage[],
  model: string,
  apiKey: string,
  paperContext: string | undefined,
  tools: ReturnType<typeof getAllTools>,
  toolContext: ToolContext,
  emit: (e: StreamEvent) => void,
) {
  const systemContent = paperContext
    ? `${SYSTEM_PROMPT}\n\n<paper>\n${paperContext}\n</paper>`
    : SYSTEM_PROMPT;

  const anthropicTools = toAnthropicTools(tools);

  // Build initial messages in Anthropic format
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

    // If no tool calls, we're done
    if (stopReason !== "tool_use") break;

    const toolCalls = contentBlocks.filter(
      (b): b is { type: "tool_use" } & AnthropicToolCall => b.type === "tool_use",
    );
    if (toolCalls.length === 0) break;

    // Add assistant message (with text + tool_use blocks) to conversation
    apiMessages.push({ role: "assistant", content: contentBlocks });

    // Execute each tool and collect results
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

    // Add tool results as a user message (Anthropic format)
    apiMessages.push({ role: "user", content: toolResults });
  }
}

/**
 * Parse an Anthropic SSE stream, emitting text_delta events in real time
 * and accumulating content blocks for the agentic loop.
 */
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

/* ================================================================== */
/*  OpenAI-compatible agentic loop                                     */
/* ================================================================== */

interface OpenAIToolCall {
  index: number;
  id: string;
  function: { name: string; arguments: string };
}

async function runOpenAIAgentLoop(
  chatMessages: ChatMessage[],
  model: string,
  apiKey: string,
  paperContext: string | undefined,
  provider: OpenAiCompatibleProvider,
  tools: ReturnType<typeof getAllTools>,
  toolContext: ToolContext,
  emit: (e: StreamEvent) => void,
) {
  const systemContent = paperContext
    ? `${SYSTEM_PROMPT}\n\n<paper>\n${paperContext}\n</paper>`
    : SYSTEM_PROMPT;

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiMessages: any[] = [
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
      let msg = `${label} API error: ${response.status}`;
      try { msg = JSON.parse(errText).error?.message || msg; } catch { /* ok */ }
      throw new Error(msg);
    }

    if (!response.body) {
      throw new Error(`No response body from ${providerApiErrorLabel(provider)}`);
    }

    const { textContent, toolCalls, finishReason } = await parseOpenAISSE(
      response.body, emit,
    );

    // If no tool calls, we're done
    if (finishReason !== "tool_calls" || toolCalls.length === 0) break;

    // Add assistant message with tool calls to conversation
    apiMessages.push({
      role: "assistant",
      content: textContent || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    });

    // Execute each tool
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

/**
 * Parse an OpenAI-compatible SSE stream with tool call support.
 */
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

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const choice = (event.choices as any[])?.[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        const delta = choice.delta;
        if (!delta) continue;

        // Text content
        if (delta.content) {
          textContent += delta.content;
          emit({ type: "text_delta", text: delta.content });
        }

        // Tool calls (streamed incrementally)
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
