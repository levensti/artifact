/**
 * Agentic journal generator. Replaces the old deterministic
 * session/digest pipelines with a single LLM call that decides — given
 * the last week of activity and the current journal pages — what (if
 * anything) should be created, updated, or left alone.
 *
 * The agent can create multiple entries per day (topic-sharded) and can
 * retroactively edit earlier sessions when new context makes them
 * clearer. The only hard constraint is that slugs must start with
 * `session-` or `digest-` so the narrowed WikiPageType union is honored.
 */

import type { Model } from "@/lib/models";
import {
  finalizeWikiIngest,
  loadWikiPages,
  type WikiFinalizePage,
} from "@/lib/client-data";
import { getRecentActivity } from "@/lib/client/session-sources";
import { beginWikiIngest, endWikiIngest } from "@/lib/wiki-status";
import { parseJson } from "@/lib/json-parse";

const LAST_RUN_KEY = "artifact:journal-agent:last-run";
const LAST_AGENT_SEEN_KEY = "artifact:journal-agent:last-activity-seen";
const DEFAULT_WINDOW_DAYS = 7;
const CHAT_DEBOUNCE_MS = 45_000;

interface RecentActivity {
  since: string;
  latestActivityAt: string | null;
  reviews: Array<{
    reviewId: string;
    title: string;
    arxivId: string | null;
    createdAt: string;
    updatedAt: string;
    isNewSinceWindow: boolean;
  }>;
  annotations: Array<{
    id: string;
    reviewId: string;
    highlightText: string;
    note: string;
    kind: string;
    createdAt: string;
  }>;
  chatMessages: Array<{
    id: string;
    reviewId: string;
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }>;
  deepDives: Array<{
    id: string;
    reviewId: string;
    paperTitle: string;
    topic: string;
    explanation: string;
    createdAt: string;
  }>;
  isEmpty: boolean;
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

export type JournalTrigger = "chat" | "wiki-load" | "manual";

export interface MaybeRefreshJournalOpts {
  model: Model;
  apiKey: string;
  apiBaseUrl?: string;
  trigger: JournalTrigger;
  /** If true, bypass the debounce + activity gate. */
  force?: boolean;
}

let inFlight = false;
let chatDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/* ------------------------------------------------------------------ */
/*  Public entry points                                                */
/* ------------------------------------------------------------------ */

/**
 * Debounced chat trigger. Restarts a trailing timer on every call —
 * fires once activity has been quiet for CHAT_DEBOUNCE_MS, so a burst
 * of chat turns collapses into one agent invocation.
 */
export function scheduleJournalAfterChat(
  opts: Omit<MaybeRefreshJournalOpts, "trigger">,
): void {
  if (chatDebounceTimer) clearTimeout(chatDebounceTimer);
  chatDebounceTimer = setTimeout(() => {
    chatDebounceTimer = null;
    void maybeRefreshJournal({ ...opts, trigger: "chat" }).catch(() => {
      /* ambient — errors surface via reportWikiIngestError */
    });
  }, CHAT_DEBOUNCE_MS);
}

/**
 * One-shot agent run. Eager on wiki-load (no debounce), debounced via
 * scheduleJournalAfterChat for chat. Safe to call concurrently — a
 * single in-flight guard prevents overlap.
 */
export async function maybeRefreshJournal(
  opts: MaybeRefreshJournalOpts,
): Promise<void> {
  if (inFlight) return;

  const now = new Date();
  const sinceIso = computeSinceIso(now);
  const activity = await fetchRecentActivity(sinceIso);
  if (!activity) return;

  if (!opts.force) {
    const lastSeen = readLs(LAST_AGENT_SEEN_KEY);
    const latest = activity.latestActivityAt;
    if (activity.isEmpty) return;
    if (latest && lastSeen && latest <= lastSeen) return;
  }

  inFlight = true;
  const token = beginWikiIngest({ kind: "journal", label: "Journaling" });
  try {
    const journal = await loadWikiPages();
    const journalEntries = journal
      .filter((p) => p.pageType === "session" || p.pageType === "digest")
      .map((p) => ({
        slug: p.slug,
        title: p.title,
        pageType: p.pageType,
        updatedAt: p.updatedAt,
        content: p.content.slice(0, 4000),
      }));

    const raw = await callAgent({
      model: opts.model,
      apiKey: opts.apiKey,
      apiBaseUrl: opts.apiBaseUrl,
      activity,
      journalEntries,
      now,
    });
    if (!raw) return;

    const parsed = parseJson<AgentResponse>(raw, {});
    const upserts = sanitizeUpserts(parsed?.upserts ?? []);
    if (upserts.length === 0) return;

    await finalizeWikiIngest({
      pages: upserts,
      logEntry: { kind: "journal", label: "Journal agent run" },
    });

    if (activity.latestActivityAt) {
      writeLs(LAST_AGENT_SEEN_KEY, activity.latestActivityAt);
    }
    writeLs(LAST_RUN_KEY, new Date().toISOString());
  } catch {
    /* ambient — don't block future runs */
  } finally {
    inFlight = false;
    endWikiIngest(token);
  }
}

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

function computeSinceIso(now: Date): string {
  const lastRun = readLs(LAST_RUN_KEY);
  if (lastRun && !Number.isNaN(Date.parse(lastRun))) {
    // Overlap slightly so a message timestamped at the exact cursor is
    // not double-missed by strict `>=` filtering.
    const d = new Date(lastRun);
    d.setMinutes(d.getMinutes() - 5);
    return d.toISOString();
  }
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() - DEFAULT_WINDOW_DAYS);
  return fallback.toISOString();
}

async function fetchRecentActivity(
  sinceIso: string,
): Promise<RecentActivity | null> {
  try {
    return (await getRecentActivity(sinceIso)) as RecentActivity;
  } catch {
    return null;
  }
}

interface CallAgentArgs {
  model: Model;
  apiKey: string;
  apiBaseUrl?: string;
  activity: RecentActivity;
  journalEntries: Array<{
    slug: string;
    title: string;
    pageType: string;
    updatedAt: string;
    content: string;
  }>;
  now: Date;
}

async function callAgent(args: CallAgentArgs): Promise<string | null> {
  const { model, apiKey, apiBaseUrl, activity, journalEntries, now } = args;
  const prompt = buildPrompt({ activity, journalEntries, now });

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.modelId,
        provider: model.provider,
        apiKey,
        ...(apiBaseUrl ? { apiBaseUrl } : {}),
        prompt,
        paperContext: "",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string };
    return typeof data.content === "string" ? data.content : null;
  } catch {
    return null;
  }
}

function buildPrompt(args: {
  activity: RecentActivity;
  journalEntries: CallAgentArgs["journalEntries"];
  now: Date;
}): string {
  const { activity, journalEntries, now } = args;
  return `You are the journal agent for a research assistant app. You curate a personal study journal for the user: session entries (what they worked on in a single focused block) and digest entries (weekly/monthly syntheses).

Today is ${now.toISOString()} (local).

ACTIVITY SINCE ${activity.since}:
${JSON.stringify(
    {
      reviews: activity.reviews,
      chatMessages: activity.chatMessages,
      annotations: activity.annotations,
      deepDives: activity.deepDives,
    },
    null,
    2,
  )}

CURRENT JOURNAL ENTRIES (${journalEntries.length}):
${JSON.stringify(journalEntries, null, 2)}

DECIDE what (if anything) should change in the journal. You can:
  1. CREATE a new session entry when the user started something genuinely new and there's no existing session that covers it. Multiple sessions per day are allowed — prefer topic-sharded sessions over one "everything today" page when the topics are distinct.
  2. UPDATE an existing session entry to fold in new chat turns / annotations / deep dives. Preserve the existing structure and voice; integrate the new material rather than appending a dated footer.
  3. CREATE or UPDATE a digest entry (weekly synthesis) if 3+ sessions on related topics exist and a synthesis would add value on top of the individual recaps.
  4. Do NOTHING if the activity is too small or too incoherent to meaningfully add to the journal.

SLUG RULES:
  - Session slugs MUST start with "session-" and be kebab-case. Examples: "session-2026-04-15-rlhf-basics", "session-2026-04-15-attention".
  - Digest slugs MUST start with "digest-" and be kebab-case. Example: "digest-week-2026-w15".
  - When UPDATING, pass the exact existing slug. When CREATING, invent a fresh unique slug.

CONTENT STYLE:
  - Session entries: a short headline blockquote, 2-3 paragraphs of narrative in second-person ("you explored…"), then bulleted sections like ## Papers, ## Moments, ## Open questions where useful.
  - Digest entries: a headline blockquote, a trajectory paragraph, then ## Themes with subheadings.
  - Reference papers inline by title. Do NOT use [[slug]] syntax anywhere.
  - Link papers to their review page with [**Title**](/review/<reviewId>) when a reviewId is available.

Return ONLY JSON of this shape — no markdown fences, no prose outside:
{
  "notes": "one-line reasoning for debugging",
  "upserts": [
    {
      "action": "create" | "update",
      "slug": "session-...",
      "title": "Human title",
      "pageType": "session" | "digest",
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
    const pageType: "session" | "digest" = slug.startsWith("digest-")
      ? "digest"
      : "session";
    // Guard: reject slugs that don't fit the journal namespace.
    if (!slug.startsWith("session-") && !slug.startsWith("digest-")) continue;
    out.push({
      slug,
      title: u.title.trim(),
      content: u.content.trim() + "\n",
      pageType,
    });
  }
  return out;
}

function readLs(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLs(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota errors */
  }
}
