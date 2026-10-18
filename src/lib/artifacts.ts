/**
 * Interactive learning materials ("artifacts") the assistant generates for a
 * review with the `create_artifact` tool. The tool call's input is the
 * artifact; the chat route saves it to `ReviewArtifact` when the turn ends,
 * and the Artifacts tab lists what's saved.
 */

import type { ToolProgress } from "@/lib/stream-types";

/** Tool name the reading agent calls to produce an artifact. */
export const CREATE_ARTIFACT_TOOL = "create_artifact";

export interface ArtifactContent {
  title: string;
  /** One or two sentences shown on the preview card. */
  summary: string;
  /** GenUI markup; sanitized at render time (sanitizeDiagramHtml, artifact mode). */
  html: string;
}

export interface ReviewArtifact extends ArtifactContent {
  id: string;
  reviewId: string;
  createdAt: string;
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

  const html = partialHtml(partialArgs);
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
