/**
 * Builders for user-initiated journal entries.
 *
 * Two surfaces use this module:
 *   - Review chat checkpoint: summarize a chat-so-far into a journal entry.
 *   - Journal NL composer: draft an entry from a free-form prompt across
 *     all recent reviews/chats/annotations.
 *
 * All three flows stream tokens — callers create the destination page
 * first (with a placeholder title and empty body), then call the streaming
 * helper with an `onText` callback that updates the live body. Titles
 * come from the caller (user input or template), not from the model.
 */

import type { Model } from "@/lib/models";
import type { ChatMessage } from "@/lib/reviews";
import type { AnnotationMessage } from "@/lib/annotations";
import { getRecentActivity } from "@/lib/client/session-sources";
import { stripCodeFences } from "@/lib/json-parse";
import { loadWikiPages } from "@/lib/client-data";

interface CallArgs {
  model: Model;
  apiKey: string;
  apiBaseUrl?: string;
}

export interface AnnotationThreadInput {
  highlightText: string;
  messages: AnnotationMessage[];
}

interface SummarizeChatArgs extends CallArgs {
  reviewId: string;
  paperTitle: string;
  arxivId: string | null;
  messages: ChatMessage[];
  /** "Dive deeper" selection threads attached to this paper. */
  annotationThreads?: AnnotationThreadInput[];
  /** Optional user-supplied angle to steer what to capture. */
  angle?: string;
  /** Called on every chunk with the accumulated body markdown so far. */
  onText?: (acc: string) => void;
}

interface AddendumChatArgs extends SummarizeChatArgs {
  /** Title of the existing entry to extend. */
  existingTitle: string;
  /** Current markdown body of the existing entry. */
  existingMarkdown: string;
}

interface ComposeFromPromptArgs extends CallArgs {
  prompt: string;
  /** Window for activity corpus, in days. Default 30. */
  windowDays?: number;
  onText?: (acc: string) => void;
}

const DEFAULT_COMPOSER_WINDOW_DAYS = 30;

/* ── Prompt builders ────────────────────────────────────────────── */

function buildChatTranscript(
  messages: ChatMessage[],
  threads: AnnotationThreadInput[] | undefined,
): string {
  const mainTranscript = messages
    .filter((m) => m.content && m.content.trim().length > 0)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const threadBlocks = (threads ?? [])
    .filter((t) => t.messages.some((m) => m.content?.trim().length > 0))
    .map((t, i) => {
      const turns = t.messages
        .filter((m) => m.content && m.content.trim().length > 0)
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n\n");
      return `--- Selection thread ${i + 1} (highlighted passage: "${t.highlightText}") ---\n${turns}`;
    })
    .join("\n\n");

  return [mainTranscript, threadBlocks].filter(Boolean).join("\n\n");
}

/* ── Streaming helpers ──────────────────────────────────────────── */

export async function summarizeChatToJournal(
  args: SummarizeChatArgs,
): Promise<string> {
  const transcript = buildChatTranscript(args.messages, args.annotationThreads);
  if (!transcript.trim()) {
    throw new Error("No chat or selection threads to summarize.");
  }

  const paperRef = `[**${args.paperTitle}**](/review/${args.reviewId})`;
  const angleBlock = args.angle?.trim()
    ? `\nUSER'S STEERING ANGLE — keep the entry focused on this:\n${args.angle.trim()}\n`
    : "";

  const prompt = `You are helping the user save a journal entry that captures their learnings from a chat about a paper.

Paper: ${args.paperTitle}${args.arxivId ? ` (arXiv:${args.arxivId})` : ""}
Paper link to use in markdown: ${paperRef}
${angleBlock}
CHAT TRANSCRIPT (main thread first; "Selection thread" blocks are deeper dives the user opened on highlighted passages):
${transcript}

Write a concise, second-person journal entry summarizing what the USER (not the assistant) was learning, asking, and concluding. Style:
  - Lead with a one-line takeaway as a markdown blockquote.
  - One short narrative paragraph framing the session.
  - ## Key takeaways — 3-6 bullets, each a concrete insight.
  - ## Open questions — 1-3 bullets, only if the chat surfaced real ones.
  - Cite the paper inline at least once as ${paperRef}.
  - Do NOT include meta-text like "in this chat" or "the assistant said".

OUTPUT FORMAT — return only the markdown body, nothing else:
  - Do NOT include a title heading (the page already has its own title).
  - No code fences, no preamble, no JSON wrapper.`;

  return streamGenerate({ ...args, prompt, onText: args.onText });
}

/**
 * Stream a markdown supplement (no title) that extends an existing journal
 * entry with new learnings from the current chat. Caller appends the
 * streamed text to the existing page body.
 *
 * The full existing entry is sent to the model so it can:
 *   - avoid repeating points already covered, and
 *   - match the existing voice and structure when adding new sections.
 */
export async function summarizeChatToJournalAddendum(
  args: AddendumChatArgs,
): Promise<string> {
  const transcript = buildChatTranscript(args.messages, args.annotationThreads);
  if (!transcript.trim()) {
    throw new Error("No chat or selection threads to summarize.");
  }

  const paperRef = `[**${args.paperTitle}**](/review/${args.reviewId})`;
  const angleBlock = args.angle?.trim()
    ? `\nUSER'S STEERING ANGLE — keep the addendum focused on this:\n${args.angle.trim()}\n`
    : "";

  const prompt = `You are extending an existing journal entry with new learnings from a chat about a paper. The user wants you to fold the new material in as an addendum — do not rewrite or repeat what's already there.

Paper: ${args.paperTitle}${args.arxivId ? ` (arXiv:${args.arxivId})` : ""}
Paper link to use in markdown: ${paperRef}

EXISTING ENTRY (titled "${args.existingTitle}"):
${args.existingMarkdown}
${angleBlock}
CHAT TRANSCRIPT (new material — main thread first; "Selection thread" blocks are deeper dives):
${transcript}

Write a focused supplement that adds ONLY what's new or refined since the existing entry. Style:
  - 1-3 short paragraphs OR a small bulleted list — whichever fits the new material best.
  - Match the existing entry's voice and tone (look at the prose above).
  - Cite the paper inline as ${paperRef} when it's the source of a new point.
  - Do NOT repeat takeaways already covered in the existing entry.
  - Do NOT include meta-text like "as a follow-up" or "in addition to the above".

OUTPUT FORMAT — return only the supplement markdown, nothing else:
  - No H1 title (the existing entry already has one).
  - No code fences, no preamble, no JSON wrapper.
  - Do NOT include a date heading; the caller adds one.`;

  return streamGenerate({ ...args, prompt, onText: args.onText });
}

export async function composeJournalEntryFromPrompt(
  args: ComposeFromPromptArgs,
): Promise<string> {
  const trimmedPrompt = args.prompt.trim();
  if (!trimmedPrompt) throw new Error("Prompt is empty.");

  const windowDays = args.windowDays ?? DEFAULT_COMPOSER_WINDOW_DAYS;
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - windowDays);
  const sinceIso = sinceDate.toISOString();

  const [activity, journalPages] = await Promise.all([
    getRecentActivity(sinceIso).catch(() => null),
    loadWikiPages().catch(() => []),
  ]);

  const journalIndex = journalPages
    .filter((p) => p.pageType === "session" || p.pageType === "digest")
    .map((p) => ({ slug: p.slug, title: p.title }));

  const corpus = activity
    ? {
        reviews: activity.reviews,
        chatMessages: activity.chatMessages,
        annotations: activity.annotations,
        deepDives: activity.deepDives,
      }
    : { reviews: [], chatMessages: [], annotations: [], deepDives: [] };

  const prompt = `You draft journal entries from a user's natural-language request, drawing on their recent research activity (reviews, chats, annotations, deep dives).

USER REQUEST:
${trimmedPrompt}

ACTIVITY CORPUS (last ${windowDays} days):
${JSON.stringify(corpus, null, 2)}

EXISTING JOURNAL ENTRIES (slug + title only):
${JSON.stringify(journalIndex, null, 2)}

Write a focused journal entry that answers the user's request using ONLY content from the corpus. Style:
  - Lead with a one-line blockquote takeaway.
  - One narrative paragraph in second person ("you've been exploring...").
  - Followed by relevant ## sections (e.g. ## Threads, ## Key papers, ## Open questions) when they fit.
  - Cite each referenced paper inline as [**Title**](/review/<reviewId>) using reviewIds from the corpus. Do not invent reviewIds.
  - When a related existing entry exists, mention it as [[slug]] inline.
  - If the corpus has nothing relevant, say so honestly in one short paragraph rather than fabricating.

OUTPUT FORMAT — return only the markdown body, nothing else:
  - Do NOT include a title heading (the page already has its own title).
  - No code fences, no preamble, no JSON wrapper.`;

  return streamGenerate({ ...args, prompt, onText: args.onText });
}

/* ── Streaming transport ────────────────────────────────────────── */

interface StreamArgs extends CallArgs {
  prompt: string;
  onText?: (acc: string) => void;
}

async function streamGenerate(args: StreamArgs): Promise<string> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model.modelId,
      provider: args.model.provider,
      apiKey: args.apiKey,
      ...(args.apiBaseUrl ? { apiBaseUrl: args.apiBaseUrl } : {}),
      prompt: args.prompt,
      paperContext: "",
      stream: true,
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) detail = `: ${data.error}`;
    } catch {
      /* ignore */
    }
    throw new Error(`/api/generate ${res.status}${detail}`);
  }
  if (!res.body) throw new Error("No response body from /api/generate.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      args.onText?.(acc);
    }
  } finally {
    reader.releaseLock();
  }

  const cleaned = stripCodeFences(acc).trim();
  if (!cleaned) {
    throw new Error("Model returned an empty response. Try a different model.");
  }
  return cleaned;
}

/* ── Slug helpers ───────────────────────────────────────────────── */

/** Build a session slug like `session-YYYY-MM-DD-<topic>`. */
export function buildSessionSlug(title: string, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const topic = slugify(title).slice(0, 40) || "entry";
  return `session-${y}-${m}-${d}-${topic}`;
}

/** Make a slug unique by appending -2, -3, ... if it collides. */
export function uniquifySlug(
  base: string,
  existingSlugs: ReadonlySet<string>,
): string {
  if (!existingSlugs.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!existingSlugs.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
