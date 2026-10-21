/**
 * Interactive learning materials ("artifacts") the assistant generates for a
 * review. `create_artifact` saves a new artifact as version 1 when it runs;
 * `update_artifact` appends a version (string edits or a full rewrite); the
 * Artifacts tab lists what's saved and opens any version.
 *
 * The page source is HTML with inline style and script, run in a sandboxed
 * iframe (see artifact-frame.ts). It never travels in chat history: the
 * persisted tool call keeps only a placeholder plus the artifact ref in its
 * output, so a shared review can't carry one along.
 */

import type { ChatAssistantBlock } from "@/lib/review-types";
import type { ToolProgress } from "@/lib/stream-types";

/** Tool name the reading agent calls to produce an artifact. */
export const CREATE_ARTIFACT_TOOL = "create_artifact";
/** Tool name for editing an existing artifact in place (a new version). */
export const UPDATE_ARTIFACT_TOOL = "update_artifact";
/** Tool name for reading an artifact's current source before editing it. */
export const READ_ARTIFACT_TOOL = "read_artifact";

const ARTIFACT_TOOLS = new Set([
  CREATE_ARTIFACT_TOOL,
  UPDATE_ARTIFACT_TOOL,
  READ_ARTIFACT_TOOL,
]);

export interface ArtifactContent {
  title: string;
  /** One or two sentences shown on the preview card. */
  summary: string;
  /** Page source, run sandboxed (see artifact-frame.ts). */
  html: string;
}

export interface ArtifactVersionMeta {
  number: number;
  /** One line on what changed ("Created", "Simplified the method section"). */
  changeSummary: string;
  createdAt: string;
}

export interface ReviewArtifact extends ArtifactContent {
  id: string;
  reviewId: string;
  /** The tool call that created it (matches legacy chat cards). */
  sourceCallId: string | null;
  /** Current version number; `html` is that version's source. */
  version: number;
  /** Every version, newest first. */
  versions: ArtifactVersionMeta[];
  /** What the reader did inside the page, saved through the bridge. */
  state: unknown;
  createdAt: string;
  updatedAt: string;
}

/** Read artifact content from a `create_artifact` tool call's input, or null
 *  when a required field is missing. */
export function artifactFromToolInput(
  input: Record<string, unknown>,
): ArtifactContent | null {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  const html = typeof input.html === "string" ? input.html.trim() : "";
  if (!title || !html) return null;
  return { title: title.slice(0, 120), summary: summary.slice(0, 400), html };
}

/* ------------------------------------------------------------------ */
/*  Artifact refs in tool output                                       */
/* ------------------------------------------------------------------ */

/** Which artifact (and version) a create/update call produced. */
export interface ArtifactRef {
  id: string;
  version: number;
}

/** The marker a create/update tool result carries, e.g.
 *  `[artifact:3f2a… v2]`. The model reads the id from it to edit later; the
 *  chat card reads it to open the right artifact. */
export function formatArtifactRef(ref: ArtifactRef): string {
  return `[artifact:${ref.id} v${ref.version}]`;
}

export function artifactRefFromOutput(
  output: string | undefined,
): ArtifactRef | null {
  if (!output) return null;
  const m = /\[artifact:([\w-]+) v(\d+)\]/.exec(output);
  return m ? { id: m[1], version: Number(m[2]) } : null;
}

/* ------------------------------------------------------------------ */
/*  Edits                                                              */
/* ------------------------------------------------------------------ */

export interface ArtifactEdit {
  old_str: string;
  new_str: string;
}

/**
 * Apply string replacements in order, all or none. Each `old_str` must occur
 * exactly once in the source as it stands after the edits before it, so an
 * edit can never land in the wrong place.
 */
export function applyArtifactEdits(
  html: string,
  edits: ArtifactEdit[],
): { ok: true; html: string } | { ok: false; error: string } {
  let out = html;
  for (const [i, edit] of edits.entries()) {
    const n = i + 1;
    if (!edit.old_str) {
      return { ok: false, error: `Edit ${n}: old_str is empty.` };
    }
    const at = out.indexOf(edit.old_str);
    if (at < 0) {
      return {
        ok: false,
        error: `Edit ${n}: old_str was not found. Copy it exactly from the current source (call read_artifact if you don't have it).`,
      };
    }
    if (out.indexOf(edit.old_str, at + 1) >= 0) {
      return {
        ok: false,
        error: `Edit ${n}: old_str occurs more than once. Include more surrounding text so it's unique.`,
      };
    }
    out = out.slice(0, at) + edit.new_str + out.slice(at + edit.old_str.length);
  }
  return { ok: true, html: out };
}

/** Well-formed edits from a tool call's input (drops malformed entries). */
export function editsFromToolInput(input: Record<string, unknown>): ArtifactEdit[] {
  if (!Array.isArray(input.edits)) return [];
  return input.edits.flatMap((e) => {
    const edit = e as Record<string, unknown> | null;
    return edit &&
      typeof edit.old_str === "string" &&
      typeof edit.new_str === "string"
      ? [{ old_str: edit.old_str, new_str: edit.new_str }]
      : [];
  });
}

/* ------------------------------------------------------------------ */
/*  Keeping page source out of chat history                            */
/* ------------------------------------------------------------------ */

/** Stands in for page source in persisted chat history. */
export const ARTIFACT_SOURCE_OMITTED =
  "[omitted: saved to the artifact, see its ref in the tool result]";

/**
 * Drop page source from artifact tool calls: create/update inputs (html,
 * edits) and read outputs. Applied before a turn is persisted and again when
 * a review is copied into a share, so artifacts live only in their own table
 * (never shared) and old source doesn't crowd the model's context. The chat
 * card finds the artifact by the ref in the output instead.
 */
export function stripArtifactSource(
  blocks: ChatAssistantBlock[],
): ChatAssistantBlock[] {
  return blocks.map((b) => {
    if (b.type !== "tool_call" || !ARTIFACT_TOOLS.has(b.name)) return b;
    const input = { ...b.input };
    if (typeof input.html === "string") input.html = ARTIFACT_SOURCE_OMITTED;
    if (Array.isArray(input.edits)) {
      input.edits = `${ARTIFACT_SOURCE_OMITTED} (${input.edits.length} edits)`;
    }
    const output =
      b.name === READ_ARTIFACT_TOOL && b.output ? ARTIFACT_SOURCE_OMITTED : b.output;
    return { ...b, input, output };
  });
}

/** `stripArtifactSource` over a list of messages' blocks. */
export function stripArtifactSourceFromMessages<
  M extends { blocks?: ChatAssistantBlock[] },
>(messages: M[]): M[] {
  return messages.map((m) =>
    m.blocks ? { ...m, blocks: stripArtifactSource(m.blocks) } : m,
  );
}

/* ------------------------------------------------------------------ */
/*  Progress while the arguments stream in                             */
/* ------------------------------------------------------------------ */

/** A complete JSON string field's value, or null if it hasn't closed yet. */
function completeField(args: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(args);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return null;
  }
}

/** The (possibly unterminated) html field, unescaped as far as it's safe. */
function partialHtml(args: string): string {
  const m = /"html"\s*:\s*"/.exec(args);
  if (!m) return "";
  let raw = args.slice(m.index + m[0].length);
  // Cut at the closing quote if the field is complete.
  const close = /(?:^|[^\\])(?:\\\\)*"/.exec(raw);
  if (close) raw = raw.slice(0, close.index + close[0].length - 1);
  // Drop a trailing escape that hasn't fully arrived (\ or \u12).
  raw = raw.replace(/\\(u[0-9a-fA-F]{0,3})?$/, "");
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").trim();

/**
 * Milestones from a `create_artifact` call's partial arguments: the title once
 * it's written, an opening step for content before the first expandable
 * section, then each section by its summary line (done once it closes).
 */
export function artifactProgress(partialArgs: string): ToolProgress {
  const progress: ToolProgress = { steps: [] };
  const title = completeField(partialArgs, "title");
  if (title) progress.title = title.trim();

  // Script bodies can mention tags; only markup counts as milestones.
  const html = partialHtml(partialArgs).replace(
    /<script\b[\s\S]*?(?:<\/script>|$)/gi,
    "",
  );
  const [intro, ...sections] = html.split(/<details\b/i);
  if (stripTags(intro)) {
    progress.steps.push({ label: "Opening summary", done: sections.length > 0 });
  }
  for (const section of sections) {
    const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(section);
    if (!summary) break;
    const label = stripTags(summary[1]);
    if (!label) continue;
    progress.steps.push({ label, done: /<\/details>/i.test(section) });
  }
  return progress;
}

/** Progress for an `update_artifact` call: its one-line change, once written. */
export function artifactUpdateProgress(partialArgs: string): ToolProgress {
  const change = completeField(partialArgs, "change");
  return change ? { title: change.trim(), steps: [] } : { steps: [] };
}
