/**
 * Agent that turns one or more parsed Claude Code sessions into
 * journal entries.
 *
 * This is a sibling of `wiki-journal-agent.ts` — same output sink
 * (`finalizeWikiIngest`), same JSON schema, same wiki-status
 * pub/sub — but a deliberately *generalized* prompt. CC sessions are
 * not always coding sessions; users use Claude Code to ramp up on
 * unfamiliar topics, draft writing, debug systems, and a long tail
 * of other things. The prompt avoids any domain assumption and lets
 * the agent infer the topic from the transcript itself.
 *
 * One agent call per imported session. We could batch, but a single
 * call per session keeps prompts within the 500 KB system-context
 * cap on `/api/generate`, gives the user an unambiguous progress
 * indicator, and means a failure on session 4 doesn't blow away
 * progress on sessions 1-3.
 */

import type { Model } from "@/lib/models";
import {
  finalizeWikiIngest,
  loadWikiPages,
  type WikiFinalizePage,
} from "@/lib/client-data";
import { parseJson } from "@/lib/json-parse";
import {
  beginWikiIngest,
  endWikiIngest,
  reportWikiIngestError,
} from "@/lib/wiki-status";
import { markImported } from "./imported-store";
import type { ParsedCcSession } from "./types";

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface ImportSessionsArgs {
  sessions: ParsedCcSession[];
  model: Model;
  apiKey: string;
  apiBaseUrl?: string;
  /** Per-session progress callback for UI. */
  onProgress?: (status: ImportProgress) => void;
}

export interface ImportProgress {
  sessionId: string;
  index: number;
  total: number;
  phase: "start" | "ok" | "skip" | "error";
  message?: string;
}

export interface ImportSessionsResult {
  importedSessionIds: string[];
  createdSlugs: string[];
  errors: Array<{ sessionId: string; message: string }>;
}

/**
 * Import a batch of parsed CC sessions into the journal. Reports
 * progress via `onProgress`. Idempotent at the session level — call
 * sites are responsible for not re-passing already-imported sessions
 * (the browser UI uses `isImported` to filter).
 */
export async function importCcSessions(
  args: ImportSessionsArgs,
): Promise<ImportSessionsResult> {
  const result: ImportSessionsResult = {
    importedSessionIds: [],
    createdSlugs: [],
    errors: [],
  };
  if (args.sessions.length === 0) return result;

  const token = beginWikiIngest({
    kind: "journal",
    label:
      args.sessions.length === 1
        ? "Importing Claude Code session"
        : `Importing ${args.sessions.length} Claude Code sessions`,
  });

  try {
    // Fetch existing journal once and reuse — we want each new session
    // to be aware of pages emitted by the previous ones, so we mutate
    // a local copy as we go.
    const initialPages = await loadWikiPages();
    const knownPages = initialPages
      .filter((p) => p.pageType === "session" || p.pageType === "digest")
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        pageType: p.pageType,
        updatedAt: p.updatedAt,
        contentPreview: p.content.slice(0, 1500),
      }));

    let i = 0;
    for (const session of args.sessions) {
      i++;
      args.onProgress?.({
        sessionId: session.meta.sessionId,
        index: i,
        total: args.sessions.length,
        phase: "start",
      });

      try {
        const upserts = await runAgentForSession({
          session,
          knownPages,
          model: args.model,
          apiKey: args.apiKey,
          apiBaseUrl: args.apiBaseUrl,
        });

        if (upserts.length === 0) {
          args.onProgress?.({
            sessionId: session.meta.sessionId,
            index: i,
            total: args.sessions.length,
            phase: "skip",
            message: "Agent decided nothing was worth journaling",
          });
          // Still mark imported — re-running on the same empty session
          // would just re-decide nothing.
          markImported([session.meta.sessionId]);
          result.importedSessionIds.push(session.meta.sessionId);
          continue;
        }

        await finalizeWikiIngest({
          pages: upserts,
          logEntry: { kind: "journal", label: "Claude Code import" },
        });

        // Update the in-memory known-pages list so subsequent sessions
        // in the batch can see what we just wrote.
        for (const u of upserts) {
          const idx = knownPages.findIndex((p) => p.slug === u.slug);
          const entry = {
            slug: u.slug,
            title: u.title,
            pageType: u.pageType,
            updatedAt: new Date().toISOString(),
            contentPreview: u.content.slice(0, 1500),
          };
          if (idx >= 0) knownPages[idx] = entry;
          else knownPages.push(entry);
        }

        markImported([session.meta.sessionId]);
        result.importedSessionIds.push(session.meta.sessionId);
        result.createdSlugs.push(...upserts.map((u) => u.slug));

        args.onProgress?.({
          sessionId: session.meta.sessionId,
          index: i,
          total: args.sessions.length,
          phase: "ok",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import failed";
        result.errors.push({ sessionId: session.meta.sessionId, message });
        args.onProgress?.({
          sessionId: session.meta.sessionId,
          index: i,
          total: args.sessions.length,
          phase: "error",
          message,
        });
      }
    }

    if (result.errors.length > 0) {
      reportWikiIngestError(
        `Claude Code import: ${result.errors.length} of ${args.sessions.length} sessions failed`,
      );
    }
  } finally {
    endWikiIngest(token);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

interface RunAgentArgs {
  session: ParsedCcSession;
  knownPages: Array<{
    slug: string;
    title: string;
    pageType: "session" | "digest";
    updatedAt: string;
    contentPreview: string;
  }>;
  model: Model;
  apiKey: string;
  apiBaseUrl?: string;
}

interface AgentUpsert {
  action?: "create" | "update";
  slug?: string;
  title?: string;
  content?: string;
  pageType?: "session" | "digest";
}

interface AgentResponse {
  notes?: string;
  upserts?: AgentUpsert[];
}

async function runAgentForSession(args: RunAgentArgs): Promise<WikiFinalizePage[]> {
  const transcript = serializeTranscript(args.session);
  const prompt = buildPrompt({
    session: args.session,
    knownPages: args.knownPages,
  });

  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model.modelId,
      provider: args.model.provider,
      apiKey: args.apiKey,
      ...(args.apiBaseUrl ? { apiBaseUrl: args.apiBaseUrl } : {}),
      prompt,
      // Ferry the (potentially huge) transcript through the
      // 500 KB-capped paperContext channel so we don't blow the
      // 50 KB prompt limit.
      paperContext: transcript,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = (await res.json()) as { error?: string };
      detail = data?.error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Agent call failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { content?: string };
  const raw = typeof data.content === "string" ? data.content : "";
  if (!raw) return [];

  const parsed = parseJson<AgentResponse>(raw, {});
  return sanitizeUpserts(parsed?.upserts ?? []);
}

/**
 * Render a parsed CC session as a plain-text transcript suitable for
 * embedding in the agent's system context. Truncates aggressively —
 * `/api/generate` rejects paperContext > 500 KB, and most CC sessions
 * fit comfortably under 200 KB.
 */
function serializeTranscript(session: ParsedCcSession): string {
  const MAX_BYTES = 400_000; // leave headroom under the 500 KB cap
  const header = [
    `Claude Code session ${session.meta.sessionId}`,
    `Project: ${session.meta.projectPath}`,
    session.meta.startedAt ? `Started: ${session.meta.startedAt}` : null,
    session.meta.lastActivityAt ? `Ended: ${session.meta.lastActivityAt}` : null,
    session.meta.summary ? `Summary: ${session.meta.summary}` : null,
    `Turns: ${session.meta.turnCount}`,
    "",
    "--- TRANSCRIPT ---",
    "",
  ]
    .filter((x): x is string => x !== null)
    .join("\n");

  const turns = session.turns
    .map((t) => `## ${t.role}${t.timestamp ? ` (${t.timestamp})` : ""}\n${t.text}`)
    .join("\n\n");

  const full = header + turns;
  if (full.length <= MAX_BYTES) return full;

  // Head + tail truncation: keep the start (where context is set up)
  // and the end (where conclusions live), drop the middle.
  const half = Math.floor((MAX_BYTES - 200) / 2);
  return (
    full.slice(0, half) +
    `\n\n--- [transcript truncated: ${full.length - MAX_BYTES + 200} chars omitted from middle] ---\n\n` +
    full.slice(full.length - half)
  );
}

function buildPrompt(args: {
  session: ParsedCcSession;
  knownPages: RunAgentArgs["knownPages"];
}): string {
  const { session, knownPages } = args;
  return `You are the journal agent for a research and learning workspace. The user just imported a transcript of a conversation they had with Claude Code (a separate CLI tool). Your job is to decide what — if anything — should be written into their personal study journal based on this conversation.

The full transcript is in your system context, wrapped in <paper> tags. Treat it as the conversation; ignore the literal "<paper>" framing.

CONVERSATION METADATA:
${JSON.stringify(
    {
      sessionId: session.meta.sessionId,
      projectPath: session.meta.projectPath,
      projectLabel: session.meta.projectLabel,
      startedAt: session.meta.startedAt,
      lastActivityAt: session.meta.lastActivityAt,
      turnCount: session.meta.turnCount,
      summary: session.meta.summary,
    },
    null,
    2,
  )}

EXISTING JOURNAL ENTRIES (${knownPages.length}):
${JSON.stringify(knownPages, null, 2)}

DECIDE what (if anything) should change in the journal. Options:
  1. CREATE a new session entry capturing what the user worked on or learned in this conversation. Multiple session entries are allowed if the conversation spans clearly distinct topics — prefer topic-sharded sessions over one omnibus page.
  2. UPDATE an existing session entry if this conversation is a clear continuation of one already in the journal (e.g. same topic, same week). Preserve the existing structure and voice; integrate new material rather than appending a dated footer.
  3. Do NOTHING if the conversation is too small, too incoherent, or too off-topic to add useful signal to a study journal. (Returning an empty upserts list is a valid outcome.)

DOMAIN NEUTRALITY:
  - Do NOT assume this is a coding session. Users use Claude Code for ramping up on new topics, debugging, writing, research, system design, math, and many other things. Infer the topic from the transcript itself.
  - Do NOT mention "Claude Code" or "the CLI" in the entry content. The journal is the user's own knowledge record — frame everything as what *they* explored and learned, not what tool they used to do it.

SLUG RULES:
  - Session slugs MUST start with "session-" and be kebab-case. Include the date and a short topic hint, e.g. "session-${(session.meta.lastActivityAt ?? new Date().toISOString()).slice(0, 10)}-rlhf-basics".
  - When UPDATING, pass the exact existing slug. When CREATING, invent a fresh unique slug.

CONTENT STYLE:
  - Start with a short headline blockquote summarizing the takeaway.
  - 2-3 paragraphs of narrative in second-person ("you explored…", "you worked through…").
  - Then bulleted sections like ## Concepts, ## Decisions, ## Open questions where they add value.
  - Do NOT use [[slug]] syntax anywhere.
  - Do NOT invent links to /review/<id> — this conversation didn't come from an Artifact review session.

Return ONLY JSON of this shape — no markdown fences, no prose outside:
{
  "notes": "one-line reasoning for debugging",
  "upserts": [
    {
      "action": "create" | "update",
      "slug": "session-...",
      "title": "Human title",
      "pageType": "session",
      "content": "full markdown content"
    }
  ]
}

If nothing is worth writing, return { "notes": "...", "upserts": [] }.`;
}

function sanitizeUpserts(raw: AgentUpsert[]): WikiFinalizePage[] {
  const out: WikiFinalizePage[] = [];
  for (const u of raw) {
    if (!u.slug || !u.title || !u.content) continue;
    const slug = u.slug.trim();
    if (!slug.startsWith("session-") && !slug.startsWith("digest-")) continue;
    const pageType: "session" | "digest" = slug.startsWith("digest-")
      ? "digest"
      : "session";
    out.push({
      slug,
      title: u.title.trim(),
      content: u.content.trim() + "\n",
      pageType,
    });
  }
  return out;
}
