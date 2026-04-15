/**
 * Types for parsed Claude Code session transcripts.
 *
 * Claude Code stores every interactive session as JSONL under
 * `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`, where
 * `<encoded-cwd>` is the project's working directory with `/` replaced
 * by `-`. Each line is a JSON record describing a turn, a tool use,
 * a tool result, a summary, etc.
 *
 * For the journal-import flow we only need the user/assistant turn
 * stream — the subset we actually want to feed into the agent. We keep
 * the parser permissive: unknown record shapes are skipped silently
 * rather than rejected, since the JSONL format is a private CC
 * implementation detail and may evolve.
 */

/** Session-level metadata extracted from a JSONL file (cheap pre-scan). */
export interface CcSessionMeta {
  /** Session UUID — used as the import idempotency key. Derived from filename. */
  sessionId: string;
  /** Decoded project working directory (e.g. "/Users/me/code/artifact"). */
  projectPath: string;
  /** Just the basename of projectPath, for compact UI labels. */
  projectLabel: string;
  /** ISO timestamp of the earliest record in the file. */
  startedAt: string | null;
  /** ISO timestamp of the latest record in the file. */
  lastActivityAt: string | null;
  /** Number of user + assistant turns (text only — tool noise excluded). */
  turnCount: number;
  /** First user message, trimmed for preview rendering. */
  firstUserMessage: string | null;
  /** Optional CC-supplied summary line, if the JSONL contains one. */
  summary: string | null;
  /** File size in bytes — useful for estimating import cost in the UI. */
  byteSize: number;
}

/** A single turn in the stripped transcript fed to the agent. */
export interface CcTurn {
  role: "user" | "assistant";
  /** Plain-text content. Tool calls and tool results are flattened to text. */
  text: string;
  /** ISO timestamp from the record, if available. */
  timestamp: string | null;
}

/** Full parsed transcript ready to be serialized into the agent prompt. */
export interface ParsedCcSession {
  meta: CcSessionMeta;
  turns: CcTurn[];
}
