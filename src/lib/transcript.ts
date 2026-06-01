/**
 * Normalized conversation transcript — the single source of truth for
 * replaying a chat history into each provider's native message format.
 *
 * The browser persists each assistant turn as an ordered list of
 * `ChatAssistantBlock`s (text segments interleaved with tool calls and their
 * outputs). Historically only the flattened *text* of each turn was sent back
 * to the server, so on every new user message the agent lost all memory of
 * what it had looked up — it re-ran searches, re-read sections, and could
 * contradict its own earlier answers.
 *
 * This module takes those persisted blocks and reconstructs faithful
 * `tool_use`/`tool_result` pairs in the shape each provider expects, so the
 * model sees its prior tool work as real tool interactions. Both chat handlers
 * seed their message array from here; the live agent loop then appends new
 * turns in the same shapes.
 */

import type { ChatAssistantBlock } from "@/lib/review-types";

/* ------------------------------------------------------------------ */
/*  Normalized transcript                                              */
/* ------------------------------------------------------------------ */

/**
 * One message as it arrives from the browser. Assistant messages may carry the
 * structured `blocks` recorded during streaming; user messages are plain text.
 * `blocks` is optional for backward compatibility with older clients (and with
 * simple text-only answers that never called a tool).
 */
export interface TranscriptMessage {
  role: "user" | "assistant";
  content: string;
  blocks?: ChatAssistantBlock[];
}

/**
 * Per-tool-result cap applied only when *replaying history*. A long reading
 * session can accumulate many large tool outputs (full sections, search
 * dumps); replaying every one verbatim on every turn would balloon the prompt.
 * The live turn's own tool results are never capped — only prior turns being
 * replayed. Raise this (or set it to Infinity) to trade tokens for fidelity.
 */
export const MAX_REPLAYED_TOOL_RESULT_CHARS = 8000;

function capToolResult(output: string): string {
  if (output.length <= MAX_REPLAYED_TOOL_RESULT_CHARS) return output;
  return (
    output.slice(0, MAX_REPLAYED_TOOL_RESULT_CHARS) +
    "\n…[earlier tool result truncated for length]"
  );
}

/**
 * Wrap a tool result so the model treats it as inert data, never as
 * instructions. Single source of truth for the wrapper format — the live agent
 * loop reuses this too (see agent-loop.ts), and the system prompt's
 * TOOL_RESULT_GUARDRAIL describes exactly this shape.
 */
export function wrapToolResult(name: string, output: string): string {
  return `<tool_result tool="${name}">\n${output}\n</tool_result>`;
}

/* ------------------------------------------------------------------ */
/*  Context budgeting                                                  */
/* ------------------------------------------------------------------ */

/**
 * Rough token estimate from character count. We deliberately avoid pulling in
 * a real tokenizer: budgeting only needs to be in the right ballpark (a margin
 * absorbs the error), and a per-provider tokenizer dependency isn't worth the
 * weight. ~4 chars/token is the standard heuristic for English + code.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Approximate token cost of one transcript message, blocks included. */
function messageTokens(m: TranscriptMessage): number {
  let n = estimateTokens(m.content);
  for (const b of m.blocks ?? []) {
    if (b.type === "text_segment") n += estimateTokens(b.content);
    else if (b.type === "tool_call") {
      n += estimateTokens(JSON.stringify(b.input));
      if (b.output) n += estimateTokens(b.output);
    }
  }
  return n;
}

/**
 * Trim a transcript so its estimated tokens fit `budgetTokens`, preserving the
 * most recent turns. Two passes, oldest-first, never touching the final
 * message (the current user turn):
 *   1. Strip tool-call blocks from old assistant turns — drops the bulky
 *      tool_use/tool_result replay while keeping the prose conclusions.
 *   2. If still over, drop whole oldest messages, then advance to the next
 *      user turn so the kept history still starts on a user message (the
 *      provider renderers want clean alternation).
 *
 * Storage always keeps the full history; this only shapes what's sent to the
 * model. Returns `trimmed: true` when anything was dropped (callers may log).
 */
export function fitTranscriptToBudget(
  messages: TranscriptMessage[],
  budgetTokens: number,
): { messages: TranscriptMessage[]; trimmed: boolean } {
  let total = messages.reduce((s, m) => s + messageTokens(m), 0);
  if (total <= budgetTokens) return { messages, trimmed: false };

  // Mutable shallow copy (own copy of each blocks array).
  const work = messages.map((m) => ({
    ...m,
    blocks: m.blocks ? [...m.blocks] : m.blocks,
  }));
  let trimmed = false;

  // Pass 1: strip tool-call blocks from oldest turns first; keep the prose.
  for (let i = 0; i < work.length - 1 && total > budgetTokens; i++) {
    const m = work[i];
    if (!m.blocks || !m.blocks.some((b) => b.type === "tool_call")) continue;
    const before = messageTokens(m);
    m.blocks = m.blocks.filter((b) => b.type !== "tool_call");
    total -= before - messageTokens(m);
    trimmed = true;
  }
  if (total <= budgetTokens) return { messages: work, trimmed };

  // Pass 2: drop whole oldest messages (never the last), then land on a user
  // turn so the surviving history opens cleanly.
  let start = 0;
  while (start < work.length - 1 && total > budgetTokens) {
    total -= messageTokens(work[start]);
    start++;
    trimmed = true;
  }
  while (start < work.length - 1 && work[start].role !== "user") start++;

  return { messages: work.slice(start), trimmed };
}

/* ------------------------------------------------------------------ */
/*  Anthropic                                                          */
/* ------------------------------------------------------------------ */

export type AnthropicHistoryBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface AnthropicHistoryMessage {
  role: "user" | "assistant";
  content: string | AnthropicHistoryBlock[];
}

/**
 * Render a normalized transcript into Anthropic `/v1/messages` format.
 *
 * Anthropic requires strict user/assistant alternation with tool_results
 * living in a user message, so a single persisted assistant turn that
 * interleaves text and tool calls expands into multiple messages: text +
 * tool_use blocks in an assistant message, then a user message holding their
 * tool_result blocks. Consecutive user messages (e.g. a trailing tool_result
 * group immediately followed by the next real question) are merged to preserve
 * alternation.
 */
export function toAnthropicMessages(
  messages: TranscriptMessage[],
): AnthropicHistoryMessage[] {
  const out: AnthropicHistoryMessage[] = [];

  const pushUser = (blocks: AnthropicHistoryBlock[]) => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === "user") {
      const prev = Array.isArray(last.content)
        ? last.content
        : [{ type: "text", text: last.content } as AnthropicHistoryBlock];
      last.content = [...prev, ...blocks];
    } else {
      out.push({ role: "user", content: blocks });
    }
  };

  for (const m of messages) {
    if (m.role === "user") {
      pushUser([{ type: "text", text: m.content }]);
      continue;
    }

    // Assistant. Without structured blocks it's a plain text answer.
    if (!m.blocks || m.blocks.length === 0) {
      if (m.content.trim()) out.push({ role: "assistant", content: m.content });
      continue;
    }

    let assistantBlocks: AnthropicHistoryBlock[] = [];
    let pendingResults: AnthropicHistoryBlock[] = [];
    const flush = () => {
      if (assistantBlocks.length) {
        out.push({ role: "assistant", content: assistantBlocks });
      }
      pushUser(pendingResults);
      assistantBlocks = [];
      pendingResults = [];
    };

    for (const b of m.blocks) {
      if (b.type === "text_segment") {
        // Text arriving after tool results means a new model turn started.
        if (pendingResults.length) flush();
        if (b.content) assistantBlocks.push({ type: "text", text: b.content });
      } else if (b.type === "tool_call") {
        // A tool_use with no recorded result can't be replayed validly (the
        // provider requires a matching result for every call) — drop it.
        if (b.output === undefined) continue;
        assistantBlocks.push({
          type: "tool_use",
          id: b.id,
          name: b.name,
          input: b.input,
        });
        pendingResults.push({
          type: "tool_result",
          tool_use_id: b.id,
          content: wrapToolResult(b.name, capToolResult(b.output)),
        });
      }
      // arxiv_hits: display-only legacy panel; nothing to replay.
    }
    flush();
  }

  return out;
}

/* ------------------------------------------------------------------ */
/*  OpenAI                                                             */
/* ------------------------------------------------------------------ */

/**
 * Render a normalized transcript into OpenAI `/chat/completions` format. An
 * assistant message carrying `tool_calls` must be immediately followed by one
 * `tool` message per call id, so each model turn flushes as
 * assistant-then-tool-results. The system message is added by the handler, not
 * here.
 */
export function toOpenAIMessages(
  messages: TranscriptMessage[],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    if (!m.blocks || m.blocks.length === 0) {
      if (m.content.trim()) out.push({ role: "assistant", content: m.content });
      continue;
    }

    let text = "";
    let toolCalls: Array<Record<string, unknown>> = [];
    let results: Array<Record<string, unknown>> = [];
    const flush = () => {
      if (text || toolCalls.length) {
        const msg: Record<string, unknown> = {
          role: "assistant",
          content: text || null,
        };
        if (toolCalls.length) msg.tool_calls = toolCalls;
        out.push(msg);
      }
      for (const r of results) out.push(r);
      text = "";
      toolCalls = [];
      results = [];
    };

    for (const b of m.blocks) {
      if (b.type === "text_segment") {
        if (results.length) flush();
        if (b.content) text += b.content;
      } else if (b.type === "tool_call") {
        if (b.output === undefined) continue;
        toolCalls.push({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        });
        results.push({
          role: "tool",
          tool_call_id: b.id,
          content: wrapToolResult(b.name, capToolResult(b.output)),
        });
      }
    }
    flush();
  }

  return out;
}
