import { describe, it, expect } from "vitest";
import {
  decodeProjectDirName,
  extractMeta,
  parseSession,
} from "@/lib/cc-import/parser";

const FIXTURE = [
  // Older record where role lives on the top-level record.
  {
    type: "user",
    timestamp: "2026-04-15T10:00:00.000Z",
    cwd: "/Users/me/code/artifact",
    message: { role: "user", content: "Help me understand RLHF basics" },
  },
  // Assistant turn with array content (text + tool use).
  {
    type: "assistant",
    timestamp: "2026-04-15T10:00:05.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Sure — RLHF stands for…" },
        {
          type: "tool_use",
          name: "Bash",
          input: { command: "ls -la" },
        },
      ],
    },
  },
  // Tool result record (we want this collapsed to a marker).
  {
    type: "user",
    timestamp: "2026-04-15T10:00:06.000Z",
    message: {
      role: "user",
      content: [
        { type: "tool_result", content: "file1\nfile2\nfile3" },
      ],
    },
  },
  // Empty content turn — should be skipped.
  {
    type: "assistant",
    timestamp: "2026-04-15T10:00:07.000Z",
    message: { role: "assistant", content: "" },
  },
  // Final answer.
  {
    type: "assistant",
    timestamp: "2026-04-15T10:00:10.000Z",
    message: {
      role: "assistant",
      content: "RLHF is reinforcement learning from human feedback.",
    },
  },
  // Summary record (no role).
  { type: "summary", summary: "User explored RLHF basics" },
]
  .map((r) => JSON.stringify(r))
  .join("\n");

describe("cc-import parser", () => {
  it("decodes project dir names", () => {
    expect(decodeProjectDirName("-Users-me-code-artifact")).toBe(
      "/Users/me/code/artifact",
    );
    // Names without leading dash are left untouched.
    expect(decodeProjectDirName("plain-name")).toBe("plain-name");
  });

  it("extracts meta with timestamps and counts", () => {
    const meta = extractMeta({
      fileName: "abc-123.jsonl",
      parentDirName: "-Users-me-code-artifact",
      byteSize: FIXTURE.length,
      text: FIXTURE,
    });
    expect(meta.sessionId).toBe("abc-123");
    expect(meta.projectPath).toBe("/Users/me/code/artifact");
    expect(meta.projectLabel).toBe("artifact");
    expect(meta.startedAt).toBe("2026-04-15T10:00:00.000Z");
    expect(meta.lastActivityAt).toBe("2026-04-15T10:00:10.000Z");
    expect(meta.firstUserMessage).toBe("Help me understand RLHF basics");
    expect(meta.summary).toBe("User explored RLHF basics");
    // 4 non-empty turns: user-1, assistant-1 (text+tool), user-2 (tool_result), assistant-3.
    expect(meta.turnCount).toBe(4);
  });

  it("flattens tool calls and results in parseSession", () => {
    const session = parseSession({
      fileName: "abc-123.jsonl",
      parentDirName: "-Users-me-code-artifact",
      byteSize: FIXTURE.length,
      text: FIXTURE,
    });
    expect(session.turns).toHaveLength(4);
    // Assistant text-and-tool-call turn should include both pieces.
    const assistantWithTool = session.turns[1];
    expect(assistantWithTool.role).toBe("assistant");
    expect(assistantWithTool.text).toContain("RLHF stands for");
    expect(assistantWithTool.text).toContain("[tool: Bash] ls -la");
    // Tool result collapsed to a marker.
    const toolResultTurn = session.turns[2];
    expect(toolResultTurn.text.startsWith("[tool result]")).toBe(true);
    expect(toolResultTurn.text).toContain("file1");
  });

  it("skips malformed lines without throwing", () => {
    const corrupt =
      "this is not json\n" +
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-15T10:00:00.000Z",
        message: { role: "user", content: "hello" },
      }) +
      "\n{ broken";
    const meta = extractMeta({
      fileName: "x.jsonl",
      parentDirName: "-tmp",
      byteSize: corrupt.length,
      text: corrupt,
    });
    expect(meta.turnCount).toBe(1);
    expect(meta.firstUserMessage).toBe("hello");
  });
});
