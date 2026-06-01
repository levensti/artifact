import { describe, it, expect } from "vitest";
import {
  toAnthropicMessages,
  toOpenAIMessages,
  wrapToolResult,
  fitTranscriptToBudget,
  MAX_REPLAYED_TOOL_RESULT_CHARS,
  type TranscriptMessage,
} from "@/lib/transcript";

/* ------------------------------------------------------------------ */
/*  Anthropic                                                          */
/* ------------------------------------------------------------------ */

describe("toAnthropicMessages", () => {
  it("passes through a plain text conversation", () => {
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "bye" },
    ];
    expect(toAnthropicMessages(msgs)).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: "hello" },
      { role: "user", content: [{ type: "text", text: "bye" }] },
    ]);
  });

  it("treats a text-only assistant (no blocks) as a string message", () => {
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "q" },
      { role: "assistant", content: "a", blocks: [] },
    ];
    const out = toAnthropicMessages(msgs);
    expect(out[1]).toEqual({ role: "assistant", content: "a" });
  });

  it("reconstructs a tool_use + tool_result pair from a tool_call block", () => {
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "find related work" },
      {
        role: "assistant",
        content: "Here you go.",
        blocks: [
          { type: "text_segment", content: "Let me search." },
          {
            type: "tool_call",
            id: "tc1",
            name: "arxiv_search",
            input: { query: "transformers" },
            output: "Found 3 papers",
          },
          { type: "text_segment", content: "Here you go." },
        ],
      },
      { role: "user", content: "thanks" },
    ];
    const out = toAnthropicMessages(msgs);
    expect(out).toEqual([
      { role: "user", content: [{ type: "text", text: "find related work" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me search." },
          {
            type: "tool_use",
            id: "tc1",
            name: "arxiv_search",
            input: { query: "transformers" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tc1",
            content: wrapToolResult("arxiv_search", "Found 3 papers"),
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Here you go." }] },
      { role: "user", content: [{ type: "text", text: "thanks" }] },
    ]);
  });

  it("groups parallel tool calls into one assistant + one user message", () => {
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "q" },
      {
        role: "assistant",
        content: "done",
        blocks: [
          { type: "tool_call", id: "a", name: "s", input: {}, output: "ra" },
          { type: "tool_call", id: "b", name: "s", input: {}, output: "rb" },
          { type: "text_segment", content: "done" },
        ],
      },
    ];
    const out = toAnthropicMessages(msgs);
    // assistant with both tool_use blocks, then one user with both results.
    expect(out[1]).toEqual({
      role: "assistant",
      content: [
        { type: "tool_use", id: "a", name: "s", input: {} },
        { type: "tool_use", id: "b", name: "s", input: {} },
      ],
    });
    expect(out[2].role).toBe("user");
    expect(out[2].content).toHaveLength(2);
    expect(out[3]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    });
  });

  it("merges a trailing tool_result group with the next user message", () => {
    // Assistant turn ends on a tool call with no final text (e.g. loop hit
    // its round cap). The trailing tool_result user message must merge with
    // the next real user question to keep user/assistant alternation valid.
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "q" },
      {
        role: "assistant",
        content: "",
        blocks: [
          { type: "tool_call", id: "a", name: "s", input: {}, output: "ra" },
        ],
      },
      { role: "user", content: "next" },
    ];
    const out = toAnthropicMessages(msgs);
    // No two consecutive user messages.
    for (let i = 1; i < out.length; i++) {
      expect(out[i].role).not.toBe(out[i - 1].role);
    }
    const lastUser = out[out.length - 1];
    expect(lastUser.role).toBe("user");
    expect(lastUser.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "a",
        content: wrapToolResult("s", "ra"),
      },
      { type: "text", text: "next" },
    ]);
  });

  it("drops a tool_call with no recorded output", () => {
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "q" },
      {
        role: "assistant",
        content: "ok",
        blocks: [
          { type: "tool_call", id: "x", name: "s", input: {} }, // no output
          { type: "text_segment", content: "ok" },
        ],
      },
    ];
    const out = toAnthropicMessages(msgs);
    // No tool_use / tool_result survive; only the text answer.
    expect(out).toEqual([
      { role: "user", content: [{ type: "text", text: "q" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ]);
  });

  it("caps oversized replayed tool results", () => {
    const big = "x".repeat(MAX_REPLAYED_TOOL_RESULT_CHARS + 500);
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "q" },
      {
        role: "assistant",
        content: "a",
        blocks: [
          { type: "tool_call", id: "t", name: "read_section", input: {}, output: big },
          { type: "text_segment", content: "a" },
        ],
      },
    ];
    const out = toAnthropicMessages(msgs);
    const userMsg = out[2];
    const block = (userMsg.content as Array<{ content: string }>)[0];
    expect(block.content.length).toBeLessThan(big.length);
    expect(block.content).toContain("truncated");
  });
});

/* ------------------------------------------------------------------ */
/*  OpenAI                                                             */
/* ------------------------------------------------------------------ */

describe("toOpenAIMessages", () => {
  it("passes through a plain text conversation", () => {
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(toOpenAIMessages(msgs)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("emits assistant tool_calls followed by tool messages", () => {
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "find" },
      {
        role: "assistant",
        content: "done",
        blocks: [
          {
            type: "tool_call",
            id: "tc1",
            name: "arxiv_search",
            input: { query: "x" },
            output: "Found 3",
          },
          { type: "text_segment", content: "done" },
        ],
      },
    ];
    const out = toOpenAIMessages(msgs);
    expect(out[0]).toEqual({ role: "user", content: "find" });
    expect(out[1]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "tc1",
          type: "function",
          function: { name: "arxiv_search", arguments: JSON.stringify({ query: "x" }) },
        },
      ],
    });
    expect(out[2]).toEqual({
      role: "tool",
      tool_call_id: "tc1",
      content: wrapToolResult("arxiv_search", "Found 3"),
    });
    expect(out[3]).toEqual({ role: "assistant", content: "done" });
  });

  it("drops a tool_call with no recorded output", () => {
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "q" },
      {
        role: "assistant",
        content: "ok",
        blocks: [
          { type: "tool_call", id: "x", name: "s", input: {} },
          { type: "text_segment", content: "ok" },
        ],
      },
    ];
    const out = toOpenAIMessages(msgs);
    expect(out).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "ok" },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  Budgeting                                                          */
/* ------------------------------------------------------------------ */

describe("fitTranscriptToBudget", () => {
  it("returns the input untouched when already under budget", () => {
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo" },
    ];
    const r = fitTranscriptToBudget(msgs, 1000);
    expect(r.trimmed).toBe(false);
    expect(r.messages).toBe(msgs);
  });

  it("strips tool calls from old turns first, keeping prose and the last turn", () => {
    const big = "x".repeat(4000); // ~1000 tokens
    const msgs: TranscriptMessage[] = [
      { role: "user", content: "q1" },
      {
        role: "assistant",
        content: "a1",
        blocks: [
          { type: "text_segment", content: "a1" },
          { type: "tool_call", id: "t", name: "read_section", input: {}, output: big },
        ],
      },
      { role: "user", content: "q2" },
    ];
    const r = fitTranscriptToBudget(msgs, 100);
    expect(r.trimmed).toBe(true);
    expect(r.messages).toHaveLength(3);
    const oldAssistant = r.messages[1];
    expect(oldAssistant.blocks?.some((b) => b.type === "tool_call")).toBe(false);
    expect(oldAssistant.blocks?.some((b) => b.type === "text_segment")).toBe(true);
    // The original input is not mutated.
    expect(msgs[1].blocks?.some((b) => b.type === "tool_call")).toBe(true);
  });

  it("drops whole oldest messages when stripping isn't enough", () => {
    const big = "y".repeat(4000);
    const msgs: TranscriptMessage[] = [
      { role: "user", content: big },
      { role: "assistant", content: big },
      { role: "user", content: "final" },
    ];
    const r = fitTranscriptToBudget(msgs, 50);
    expect(r.trimmed).toBe(true);
    expect(r.messages).toEqual([{ role: "user", content: "final" }]);
  });

  it("lands on a user turn after dropping so history opens cleanly", () => {
    const big = "z".repeat(8000);
    const msgs: TranscriptMessage[] = [
      { role: "assistant", content: big }, // leading assistant (edge)
      { role: "user", content: "u1" },
      { role: "assistant", content: "final" },
    ];
    const r = fitTranscriptToBudget(msgs, 50);
    expect(r.trimmed).toBe(true);
    expect(r.messages[0].role).toBe("user");
  });
});
