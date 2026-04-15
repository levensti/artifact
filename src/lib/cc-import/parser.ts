/**
 * Parser for Claude Code JSONL session transcripts.
 *
 * The CC JSONL format is an undocumented implementation detail and has
 * shifted over time. Records we care about typically look like:
 *
 *   { "type": "user",       "timestamp": "...", "cwd": "...", "message": {...} }
 *   { "type": "assistant",  "timestamp": "...", "message": {...} }
 *   { "type": "summary",    "summary": "..." }
 *
 * `message` mirrors the Anthropic Messages API: `role` plus `content`
 * which is either a plain string or an array of content blocks
 * (`{type: "text", text}`, `{type: "tool_use", ...}`,
 * `{type: "tool_result", ...}`). We flatten all of that into plain
 * text and keep only the turns the journal agent can actually reason
 * about — tool noise is reduced to a one-liner so the agent still
 * sees that *some* tool ran but isn't drowned in giant tool outputs.
 *
 * The parser is intentionally permissive: any line that fails to JSON
 * parse, or whose shape we don't recognize, is skipped silently. We
 * never throw on malformed records — a partially-corrupt session
 * should still import what it can.
 */

import type { CcSessionMeta, CcTurn, ParsedCcSession } from "./types";

/* ------------------------------------------------------------------ */
/*  Public entry points                                                */
/* ------------------------------------------------------------------ */

/**
 * Cheap pre-scan: parse just enough of the file to populate the
 * session-browser row. Walks every line (we need timestamps and
 * turn count) but doesn't retain message bodies in memory beyond
 * the first user message preview.
 */
export function extractMeta(args: {
  fileName: string;
  parentDirName: string;
  byteSize: number;
  text: string;
}): CcSessionMeta {
  const { fileName, parentDirName, byteSize, text } = args;
  const sessionId = stripJsonlExtension(fileName);
  const projectPath = decodeProjectDirName(parentDirName);
  const projectLabel = basename(projectPath);

  let startedAt: string | null = null;
  let lastActivityAt: string | null = null;
  let turnCount = 0;
  let firstUserMessage: string | null = null;
  let summary: string | null = null;

  for (const line of iterLines(text)) {
    const record = safeJsonParse(line);
    if (!record || typeof record !== "object") continue;

    const r = record as Record<string, unknown>;

    // CC sometimes embeds a session summary as its own record type.
    if (typeof r.summary === "string" && summary === null) {
      summary = r.summary.trim() || null;
    }

    const ts = typeof r.timestamp === "string" ? r.timestamp : null;
    if (ts) {
      if (startedAt === null || ts < startedAt) startedAt = ts;
      if (lastActivityAt === null || ts > lastActivityAt) lastActivityAt = ts;
    }

    const role = extractRole(r);
    if (role === "user" || role === "assistant") {
      const text = extractText(r);
      // Skip empty turns — usually CC bookkeeping records.
      if (text.trim().length === 0) continue;
      turnCount++;
      if (role === "user" && firstUserMessage === null) {
        firstUserMessage = truncate(text.trim(), 240);
      }
    }
  }

  return {
    sessionId,
    projectPath,
    projectLabel,
    startedAt,
    lastActivityAt,
    turnCount,
    firstUserMessage,
    summary,
    byteSize,
  };
}

/**
 * Full parse: returns the meta plus the flattened turn stream the
 * agent will consume. Use this only for sessions the user has
 * actually selected to import — not for the browser pre-scan.
 */
export function parseSession(args: {
  fileName: string;
  parentDirName: string;
  byteSize: number;
  text: string;
}): ParsedCcSession {
  const meta = extractMeta(args);
  const turns: CcTurn[] = [];

  for (const line of iterLines(args.text)) {
    const record = safeJsonParse(line);
    if (!record || typeof record !== "object") continue;
    const r = record as Record<string, unknown>;

    const role = extractRole(r);
    if (role !== "user" && role !== "assistant") continue;

    const text = extractText(r);
    if (text.trim().length === 0) continue;

    turns.push({
      role,
      text,
      timestamp: typeof r.timestamp === "string" ? r.timestamp : null,
    });
  }

  return { meta, turns };
}

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

function* iterLines(text: string): IterableIterator<string> {
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      const line = text.slice(start, i);
      start = i + 1;
      if (line.length > 0) yield line;
    }
  }
  if (start < text.length) {
    const tail = text.slice(start);
    if (tail.length > 0) yield tail;
  }
}

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Extract the role from a record. CC sometimes puts the role on the
 * record itself (`type: "user"`) and sometimes only inside `message`
 * (`message.role: "user"`). We accept either.
 */
function extractRole(r: Record<string, unknown>): string | null {
  if (typeof r.type === "string" && (r.type === "user" || r.type === "assistant")) {
    return r.type;
  }
  const msg = r.message;
  if (msg && typeof msg === "object") {
    const role = (msg as Record<string, unknown>).role;
    if (typeof role === "string") return role;
  }
  return null;
}

/**
 * Flatten the message body into plain text. Handles:
 *   - `message.content` as string
 *   - `message.content` as array of content blocks
 *   - top-level `content` (older CC formats)
 *   - `text` field (very old formats)
 *
 * Tool calls and tool results collapse to short markers like
 * "[tool: Bash] ls -la" so the agent retains structural awareness
 * without ingesting megabytes of tool output.
 */
function extractText(r: Record<string, unknown>): string {
  const msg = r.message;
  let content: unknown = undefined;
  if (msg && typeof msg === "object") {
    content = (msg as Record<string, unknown>).content;
  }
  if (content === undefined) content = r.content;
  if (content === undefined) content = r.text;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
        continue;
      }
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      const type = typeof b.type === "string" ? b.type : "";
      if (type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      } else if (type === "tool_use") {
        const name = typeof b.name === "string" ? b.name : "tool";
        const input = b.input;
        const summary = summarizeToolInput(input);
        parts.push(summary ? `[tool: ${name}] ${summary}` : `[tool: ${name}]`);
      } else if (type === "tool_result") {
        const out = stringifyToolResult(b.content);
        if (out) parts.push(`[tool result] ${truncate(out, 400)}`);
      }
    }
    return parts.join("\n");
  }

  return "";
}

function summarizeToolInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return truncate(input, 200);
  if (typeof input !== "object") return String(input);
  // Pull a few common fields that summarise most CC tool calls.
  const o = input as Record<string, unknown>;
  for (const key of ["command", "file_path", "path", "pattern", "url", "query", "prompt"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim().length > 0) {
      return truncate(v.trim(), 200);
    }
  }
  try {
    return truncate(JSON.stringify(o), 200);
  } catch {
    return "";
  }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
    } else if (block && typeof block === "object") {
      const b = block as Record<string, unknown>;
      if (typeof b.text === "string") parts.push(b.text);
    }
  }
  return parts.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function stripJsonlExtension(fileName: string): string {
  return fileName.replace(/\.jsonl$/i, "");
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/**
 * Reverse the CC project-directory encoding scheme. CC takes the
 * project's working directory and replaces every "/" with "-", so
 * `/Users/me/code/artifact` becomes `-Users-me-code-artifact`. We
 * undo this by replacing every "-" with "/" — but only when the
 * directory name actually starts with "-" (the marker for the encoded
 * absolute path). Otherwise we leave it untouched.
 *
 * This is a lossy round-trip: project paths that legitimately contain
 * "-" characters will get over-substituted. We accept that — the
 * decoded path is only used as a UI label, never as a filesystem
 * lookup.
 */
export function decodeProjectDirName(name: string): string {
  if (!name.startsWith("-")) return name;
  return name.replace(/-/g, "/");
}
