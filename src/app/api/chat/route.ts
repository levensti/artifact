/**
 * Agentic chat endpoint.
 *
 * Implements a server-side ReAct loop: the LLM can call tools (arXiv search,
 * web search, etc.) as many times as needed, and the loop feeds results
 * back until the LLM produces a final text response.
 *
 * Streams NDJSON events to the client:
 *   {"type":"text_delta","text":"..."}
 *   {"type":"tool_call","id":"...","name":"...","input":{...}}
 *   {"type":"tool_result","id":"...","name":"...","output":"..."}
 *   {"type":"error","message":"..."}
 *   {"type":"done"}
 */

import { NextRequest } from "next/server";
import { OPENROUTER_CONTEXT_WINDOW } from "@/lib/openrouter";
import type { StreamEvent } from "@/lib/stream-types";
import { jsonError } from "@/lib/api-utils";
import { resolveOpenRouterKey } from "@/server/provider-env";
import { getAllTools } from "@/tools/registry";
import type { ToolContext } from "@/tools/types";
import {
  estimateTokens,
  fitTranscriptToBudget,
  type TranscriptMessage,
} from "@/lib/transcript";
import {
  processStreamEvent,
  stepsToBlocks,
  stepsToContent,
  type AgentStep,
} from "@/lib/agent-steps";
import { requireUserId, HttpError, errorResponse } from "@/server/api";
import * as store from "@/server/store";
import { buildPaperBlock } from "./paper-block";
import { runOpenRouterAgentLoop } from "./openrouter-handler";
import type { ChatMessage, ParsedPaper } from "@/lib/review-types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatRequest {
  /**
   * Stateless history (legacy path). Used by the discover surface and the
   * selection-thread chat: the client owns the transcript and sends it inline.
   * For the main review chat the server now owns state — see `userMessage`.
   * Assistant messages may carry structured `blocks` (text interleaved with
   * tool calls + outputs) so the agent can replay its own prior tool work.
   */
  messages?: TranscriptMessage[];
  /**
   * Server-owned path (main review chat). The new user message text. When
   * present (with `reviewId`, non-discover), the server loads the conversation
   * from the DB, appends + persists this turn, budgets it to the model's
   * context window, and persists the assistant reply on completion — the
   * client no longer sends or stores the history.
   */
  userMessage?: string;
  /** Client-generated id for the new user message, so optimistic UI and the
   *  persisted row share an id. Re-sending the same id is idempotent (a retry
   *  re-runs the stored turn instead of duplicating it). */
  userMessageId?: string;
  /** Client-generated id for the assistant reply, for the same id alignment. */
  assistantMessageId?: string;
  /** Re-run the last stored user message without appending a new one. Used by
   *  the Exa-key resume flow after the turn paused waiting on a key decision. */
  resume?: boolean;
  /** Optional per-user OpenRouter key override. Server falls back to env. */
  apiKey?: string;
  /**
   * Full paper text. For short papers (<~30k tokens) the browser sends this
   * and the agent works directly off it. For long papers, the browser sends
   * `parsedPaper` instead and the agent fetches sections on demand via tools.
   */
  paperContext?: string;
  /**
   * Structured paper representation (L1 summary, sections, references). Sent
   * for long papers in place of `paperContext`. When present, the chat handler
   * puts only the summary + table of contents in the system prompt and
   * exposes `read_section` / `search_paper` / `lookup_citation` for detail.
   */
  parsedPaper?: ParsedPaper;
  paperTitle?: string;
  arxivId?: string;
  reviewId?: string;
  /** Set when the review is for an arbitrary web page rather than a paper/PDF. */
  sourceUrl?: string;
  /**
   * Selects which system prompt and tool subset to use. Default is the
   * paper/web reading agent. `"discover"` swaps in a discovery-focused
   * prompt and (since there's no paper context) only registers
   * `arxiv_search` and `web_search` — paper-internal tools are already
   * gated by `parsedPaper` so they self-disable in this mode.
   */
  mode?: "discover";
  /**
   * User-provided Exa API key. When absent the `web_search` tool returns
   * a sentinel that the chat UI surfaces as a configure card.
   */
  exaApiKey?: string;
  /**
   * Set when the user has explicitly dismissed the "configure Exa key"
   * card and wants the agent to proceed without web search. The chat
   * handler unregisters `web_search` for the turn so the agent doesn't
   * attempt it again.
   */
  skipWebSearch?: boolean;
}

/* ------------------------------------------------------------------ */
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

/** Exa-backed `web_search` description + sentinel handling. Shared across all
 *  three surfaces so the neural-query phrasing guidance never drifts. */
const WEB_SEARCH_NOTE =
  "`web_search` — ground claims with real sources and current documentation. " +
  "Backed by Exa's neural search: phrase the query as a natural-language description of " +
  'the ideal page ("a clear explanation of X for someone who knows Y"), not as keywords. ' +
  'If it returns "EXA_KEY_REQUIRED", the UI is already prompting the user to add a key — ' +
  "do NOT verbalize the failure; continue with what you have.";

/** Never-fabricate rule. Shared by the reading and discover surfaces. */
const NEVER_INVENT =
  "Never invent papers, URLs, or arXiv IDs. If you're unsure a citation is real, " +
  "search for it or leave it out.";

/** Knowledge-first, but search-to-fill-gaps: answer from expertise by default,
 *  and when you genuinely lack something, fetch it instead of disclaiming. */
const KNOWLEDGE_FIRST =
  "Lean on your own knowledge first — you have deep expertise across these topics, so answer " +
  "directly when you can. But when a question needs something you don't have — real papers to " +
  "cite, recent developments, or external facts — use a tool to find out rather than guessing or replying that you don't know.";

/** Selection-thread grounding. Applies to both reading surfaces. */
const THREAD_GROUNDING =
  "When the user starts a thread from a quoted passage, ground your answer in that " +
  "passage and the surrounding context it comes from.";

/** Length + tone calibration. Identical across reading surfaces. */
const LENGTH_AND_TONE = `Length — match the answer to the question. There is no target length.
- Clarifications and definitions usually take 1–3 sentences.
- Focused questions ("what's the key claim?", "summarize a section") usually take a tight paragraph.
- Walkthroughs ("explain the method end-to-end", "compare to prior work") take structured multi-paragraph prose with equations and refs.

Don't restate the question, don't preface with "Great question", don't add caveats unless they actually matter. Be selective — surface what matters for this question, not everything you know.`;

/** Curated reading-list format, used when the user asks what to read next. */
const PICKS_FORMAT =
  'When the user explicitly asks for a list of papers to read (e.g. "find related work ' +
  'on X", "what should I read after this?"), emit a curated list under a `**Picks**` ' +
  "heading: 3–7 numbered items, each as " +
  "`**[Title](https://arxiv.org/abs/ID)** — one sentence on why it fits.` " +
  "(No abstract paraphrase, no author/year/venue — those render as a card around the " +
  "link.) Don't use the Picks format for normal explanatory answers.";

/**
 * Authoritative, doc-grounded Mermaid reference. Rather than patching syntax
 * mistakes one at a time, we give the model a minimal *valid* template for
 * each diagram type we support (verified against the official Mermaid docs)
 * plus the cross-cutting rules that cause most parse failures (unquoted
 * labels, styling, multi-series charts). The renderer also auto-repairs the
 * common slips, but getting valid output up front is the real fix.
 */
const MERMAID_GUIDE = `Mermaid reference. Emit a diagram inside a fenced code block whose language tag is literally \`mermaid\` (always the word "mermaid", NOT the diagram type) — the diagram type is the first line INSIDE the block. Choose the type whose first line matches the job, and copy the template's syntax exactly. Never use ASCII art.

Rules for every diagram:
- Quote any label containing anything beyond letters, digits, and spaces — parentheses, commas, slashes, colons, math. Write A["f(x), g/h"], never A[f(x), g/h]. Use <br/> for line breaks, only inside a quoted label.
- Plain text only — no LaTeX or $…$ inside a diagram.
- No styling of any kind: no colors, no style/classDef/fill directives, no per-element formatting.
- Keep it small — few nodes, short labels.

Templates (each is valid as-is):

Flowchart — pipelines, decision flows, trees:
flowchart LR
  A["Input"] --> B{"Converged?"}
  B -->|no| A
  B -->|yes| C["Output"]

Sequence — interactions/messages over time:
sequenceDiagram
  participant U as User
  U->>Server: request
  Server-->>U: response

State machine — states and transitions:
stateDiagram-v2
  [*] --> Idle
  Idle --> Running: start
  Running --> [*]

Mindmap — concept/taxonomy breakdown (indentation = hierarchy):
mindmap
  root["Attention"]
    A["Self-attention"]
    B["Cross-attention"]

Timeline — chronology/lineage (one entry per period; ' : ' separates events):
timeline
  title Lineage
  2017 : Transformer
  2018 : BERT : GPT-2

Quadrant — items placed on two axes:
quadrantChart
  title Speed vs accuracy
  x-axis Low Speed --> High Speed
  y-axis Low Accuracy --> High Accuracy
  Method A: [0.3, 0.6]
  Method B: [0.7, 0.8]

Block diagram — architecture/layout blocks (columns N sets the grid width):
block-beta
  columns 3
  A["Embed"] B["Encoder"] C["Decoder"]
  A --> B
  B --> C

Architecture — systems/services (icon in parens: cloud, database, disk, server, internet):
architecture-beta
  group sys[System]
  service db(database)[Store] in sys
  service api(server)[API] in sys
  db:L -- R:api

Radar — compare items across several metrics (each curve is labeled):
radar-beta
  axis a["Speed"], b["Accuracy"], c["Memory"]
  curve m["Model X"]{80, 90, 60}
  max 100
  min 0

Pie — proportions/composition of a whole (e.g. dataset split, compute breakdown). Labels quoted, values numeric:
pie title Dataset composition
  "Train" : 70
  "Validation" : 15
  "Test" : 15

XY chart — a numeric series across categories. NO legend and NO per-series labels or colors; a bar line is just the value array. For multiple labeled series or yes/no flags, use a Markdown table instead, not a chart:
xychart-beta
  title "Throughput by batch size"
  x-axis [1, 2, 4, 8, 16]
  y-axis "Tokens/s" 0 --> 1000
  bar [120, 240, 460, 700, 950]`;

type ReadingKind = "paper" | "web";

/**
 * Build the system prompt for a reading surface (paper or web page). The two
 * are the same agent: they differ only in the source noun, how the source
 * appears in context, and the citation style. Everything else — tools, search
 * policy, length, tone, format — is shared, so web reading gets the same
 * grounding discipline papers do.
 */
function buildReadingPrompt(kind: ReadingKind): string {
  const isPaper = kind === "paper";
  const noun = isPaper ? "paper" : "page";

  const role = isPaper
    ? "You are a research assistant working alongside someone reading an academic paper. Your job: help them understand the paper deeply and the ideas around it — explain, search, discover, connect."
    : "You are a research assistant working alongside someone reading a web page — an article, blog post, or documentation. Your job: help them understand it deeply and the ideas around it — explain, search, discover, connect.";

  // Both surfaces support long-mode: a short source arrives as full text; a
  // long one is parsed to a summary + ToC with the source-internal tools
  // registered (the chat route gates those tools on the parsed paper).
  const sourceInContext = `How the ${noun} appears in your context:
- For a short ${noun}, the source block contains the full text. Read it directly.
- For a long ${noun}, the source block contains only the title, an L1 summary, and a numbered table of contents. Use \`read_section\` (by name or index), \`search_paper\` (to find passages by query), or \`lookup_citation\` (to resolve a reference) to fetch specific content. Don't pretend to read what you haven't fetched — if the summary doesn't cover a question, fetch the relevant section.`;

  const tools = `Tools:
- \`read_section\`, \`search_paper\`, \`lookup_citation\` — source-internal content (long-${noun} mode only)
- \`arxiv_search\` — search Semantic Scholar + arXiv for papers
- ${WEB_SEARCH_NOTE}`;

  const grounding = isPaper
    ? `Citations:
- Cite the paper inline for every distinct statement you make about it. Each one gets its own locator. Don't bundle multiple statements behind a single trailing reference.
- Sections: write "(§N)", "(§N.M)", or "(§N.M.K)". Always cite at the deepest subsection level that actually grounds the claim. Prefer "(§4.2.1)" over "(§4.2)" when the statement comes from that subsection specifically.
- Figures: write "(Fig. N)" — e.g. "(Fig. 3)" or "(Fig. 3.2)". For multi-panel figures, cite the parent number and describe the panel in prose ("the right panel of (Fig. 3) shows..."), not "(Fig. 3a)".
- Tables: write "(Table N)" — e.g. "(Table 1)". Tables are dense, so always pair the citation with the specific row, column, or comparison you want the reader to focus on ("the 'GLUE avg.' column of (Table 2)").
- Equations: write "(Eq. N)". A cited work in the reference list: write "(Ref. [key])".
- These all auto-render as clickable nav chips.
- ${THREAD_GROUNDING}`
    : `Grounding:
- Anchor every claim about the page in the page itself: quote the key phrase or name the heading/section it comes from rather than paraphrasing vaguely.
- For arXiv papers you surface via search, cite them with the abs link.
- ${THREAD_GROUNDING}`;

  const format = `Format:
- Math: LaTeX wrapped in $ (inline) or $$ (block).
- For arXiv papers found via search, include the link https://arxiv.org/abs/ID.
- Default to prose. Use lists or headers only when the answer is genuinely list-shaped (comparing N items, an M-step walkthrough).
- Tables: use a GitHub-flavored Markdown table only when every cell is a terse, scannable value — numbers, short labels, ✓/✗ — lined up so columns compare at a glance (e.g. models × metrics, methods × properties). Give every column a header. If a column would hold full sentences or a paragraph (a description, a "why it matters", a rationale), that's not a table — use a list with a bold lead-in and the explanation beneath, or prose. Never put multi-sentence text in a cell, and don't table a single pair.
- Diagrams: emit a Mermaid diagram (see the Mermaid reference below) when a method, architecture, flow, or relationship is genuinely clearer drawn than described; otherwise prefer prose or a table.
- ${PICKS_FORMAT}`;

  return [
    role,
    sourceInContext,
    tools,
    KNOWLEDGE_FIRST,
    grounding,
    LENGTH_AND_TONE,
    format,
    MERMAID_GUIDE,
    NEVER_INVENT,
  ].join("\n\n");
}

const PAPER_SYSTEM_PROMPT = buildReadingPrompt("paper");
const WEB_SYSTEM_PROMPT = buildReadingPrompt("web");

const DISCOVERY_SYSTEM_PROMPT = `You are a research discovery agent. Your job is to help the user UNDERSTAND a topic, not to dump a pile of links on them. Each run produces two things: a short synthesized explainer that actually teaches the topic, and a curated reading list (via \`submit_picks\`) of the few sources worth reading. Sources are arXiv / Semantic Scholar papers AND high-signal web sources (lab blog posts, technical writeups from researchers or companies, official docs, authoritative surveys) — web sources are first-class picks, not a fallback. For practical or engineering topics ("deterministic LLM training", "RAG eval setup", "vLLM tuning"), a well-written blog post often beats an academic paper; don't reflexively reach for arXiv when the better resource is on the web.

DEPTH OVER BREADTH. This is the most important thing. A good run is a few well-chosen searches, the handful of sources that genuinely matter, and a clear synthesis — NOT a dozen searches enumerating every sub-angle and twenty verified candidates. The user wants understanding and a short, confident reading list, not exhaustive recall. Resist the urge to run a separate search for every sub-topic you can think of; that produces a wall of noise, not insight. Pick the threads that matter and go.

How you work:
- Two search tools, different query styles: \`arxiv_search\` takes concrete keywords; \`web_search\` (Exa, neural) takes a natural-language description of the ideal page ("an engineering blog post on tuning vLLM throughput for long contexts"). Run \`web_search\` by default unless the query is clearly purely academic ("speculative decoding 2024 NeurIPS papers").
- Keep it tight: 2–4 searches TOTAL is usually enough to map a topic. Emit them together in ONE turn so they run in parallel. Only broaden (with different terminology) if that first batch came back thin — don't pre-emptively fan out across every angle.
- Verify only the few candidates you actually intend to recommend — call \`paper_details\` on roughly 3–6 of them, together in one parallel turn, not on every result you saw. \`paper_details\` accepts either a bare arXiv id ("2401.12345") or the full URL. Titles mislead, so verify before committing; web candidates need no separate call (use the search snippet).
- If your searches come back empty, broaden before giving up: swap the user's jargon for the canonical academic term ("bitwise determinism" → "deterministic training"), drop an over-specific token, or search the underlying problem instead of the named solution. Only when two genuinely different rounds return literally nothing should you give a one-to-two-sentence refusal suggesting a reformulation.
- If \`web_search\` returns "EXA_KEY_REQUIRED", the UI is handling it — continue with what you have and don't verbalize it.

What you deliver:
1. Call \`submit_picks\` exactly once with 4–6 picks (fewer if the pool is genuinely small — a short confident list beats a padded one). Mix papers and web freely. Each pick: the canonical URL (arXiv abs URL for papers, source URL for web), the title, and a one-sentence rationale grounded in evidence — the verified TLDR/abstract for papers, the search description for web — that says what the source actually contributes, not a paraphrase of its title. Set \`arxivId\` only for arXiv picks.
2. After \`submit_picks\` returns, write the EXPLAINER: one to two short paragraphs of tight prose that genuinely teach the topic. Lead with the core idea in plain terms, then lay out the main threads and how the work divides, then say which pick to read first and why. Reference your picks inline by title (e.g. "the DiT architecture (Peebles & Xie)") so the reader can connect each claim to a source. This is the headline the user reads first — it must stand on its own as a useful explanation, not a meta-description of your search. No headers, no bullet lists, prose only. NEVER "Picks submitted." and never just a restatement of the titles. Then stop.

Constraints:
- \`submit_picks\` is the only way the reading list reaches the user. Once any search has returned anything, you MUST call it — never trail off into text without it, never end a turn with no tool call and no submitted picks. If you write text in a turn, any tool calls for that turn MUST live in the same response.
- A clarifying question is a LAST RESORT, allowed only when the query is genuinely contentless — a bare term with nothing concrete to search on (e.g. "AI", "help", "models") — and only before you've searched. Anything topical ("linear attention", "RAG", "transformers", "diffusion") IS searchable: choose the most useful interpretation, lead with the dominant thread, and let the user refine via follow-up. Ambiguity between sub-angles (foundational vs. engineering, image vs. video, theory vs. SOTA) is NOT a reason to ask — pick the most useful reading and name the angle you led with in the explainer.
- ${NEVER_INVENT}

Tone: dense, librarian-level. Technical user.`;

function getSystemPrompt(
  sourceUrl: string | undefined,
  mode: ChatRequest["mode"],
): string {
  if (mode === "discover") return DISCOVERY_SYSTEM_PROMPT;
  return sourceUrl ? WEB_SYSTEM_PROMPT : PAPER_SYSTEM_PROMPT;
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const {
    messages,
    userMessage,
    userMessageId,
    assistantMessageId,
    resume,
    apiKey,
    paperContext,
    parsedPaper,
    paperTitle,
    arxivId,
    reviewId,
    sourceUrl,
    exaApiKey,
    skipWebSearch,
    mode,
  } = body;

  // Server-owned path: the main review chat sends a single `userMessage` + a
  // `reviewId` instead of the full transcript, and the server owns load /
  // persist / context-budgeting. Discover and the selection-thread chat keep
  // the legacy stateless `messages` array.
  const isStateful =
    mode !== "discover" &&
    typeof reviewId === "string" &&
    reviewId.length > 0 &&
    (typeof userMessage === "string" || resume === true);

  if (!isStateful && (!Array.isArray(messages) || messages.length === 0)) {
    return jsonError("Messages array is required and must not be empty.", 400);
  }

  // Resolve the OpenRouter key: the user's inline override when present,
  // otherwise the platform env key. Never echoed back — used only upstream.
  const resolvedApiKey = resolveOpenRouterKey(apiKey);
  if (!resolvedApiKey) {
    return jsonError("API key is required.", 401);
  }

  const trimmedExaKey =
    typeof exaApiKey === "string" ? exaApiKey.trim() : "";
  // Always register all tools — web_search included. When the user has no
  // Exa key, the tool returns a sentinel that the chat UI surfaces as an
  // inline "Add Exa API key" card rather than the agent verbalizing the
  // failure. The exception: if the user dismissed the card, we drop
  // web_search so the agent can't even try. We also drop the paper-internal
  // tools (read_section / search_paper / lookup_citation) when the paper
  // hasn't been parsed into structured form — otherwise the agent sees them
  // in its toolset and calls them only to get a "not parsed yet" error back.
  const PAPER_PARSED_TOOLS = new Set([
    "read_section",
    "search_paper",
    "lookup_citation",
  ]);
  const DISCOVER_ONLY_TOOLS = new Set(["submit_picks"]);
  const tools = getAllTools().filter((t) => {
    if (skipWebSearch && t.name === "web_search") return false;
    if (!parsedPaper && PAPER_PARSED_TOOLS.has(t.name)) return false;
    // Structured-output tools only register for the surface that uses them.
    if (mode !== "discover" && DISCOVER_ONLY_TOOLS.has(t.name)) return false;
    return true;
  });
  const toolContext: ToolContext = {
    paperContext,
    parsedPaper,
    paperTitle,
    arxivId,
    reviewId,
    exaApiKey: trimmedExaKey || undefined,
  };
  const systemPrompt = getSystemPrompt(sourceUrl, mode);

  // Resolve the conversation to send the model. Server-owned path: load it
  // from the DB, append the new user turn, then budget it to the model's
  // context window. Persistence happens AFTER the stream (see below) so the
  // only pre-stream cost is auth + one history read — nothing blocks
  // time-to-first-token. Legacy path: the client supplied the transcript.
  let conversation: TranscriptMessage[];
  let persist: { userId: string; reviewId: string; base: ChatMessage[] } | null =
    null;
  if (isStateful) {
    try {
      const userId = await requireUserId();
      const history = await store.getMessages(userId, reviewId!);
      const last = history[history.length - 1];
      let base: ChatMessage[];
      if (resume || (last?.role === "user" && last.id === userMessageId)) {
        // Resume (Exa-key decision) or an idempotent retry: the user turn is
        // already stored. Re-run the existing history rather than duplicating.
        base = history;
      } else {
        const userMsg: ChatMessage = {
          id: userMessageId || crypto.randomUUID(),
          role: "user",
          content: userMessage ?? "",
          timestamp: new Date().toISOString(),
        };
        base = [...history, userMsg];
      }
      persist = { userId, reviewId: reviewId!, base };

      // Budget the conversation to fit the model's context window. Storage
      // keeps the full history; this only shapes what's sent to the model.
      const paperBlock = buildPaperBlock(paperContext, parsedPaper) ?? "";
      const overhead =
        estimateTokens(systemPrompt) + estimateTokens(paperBlock) + 2_000;
      const historyBudget =
        OPENROUTER_CONTEXT_WINDOW - 16_384 - overhead - 2_000;
      conversation = fitTranscriptToBudget(
        base,
        Math.max(4_000, historyBudget),
      ).messages;
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err);
      throw err;
    }
  } else {
    conversation = messages!;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Accumulate the assistant turn server-side (server-owned path only) so
      // we can persist it on completion — same step logic the client renders.
      let steps: AgentStep[] = [];
      const emit = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* controller may be closed */
        }
        if (persist) steps = processStreamEvent(steps, event);
      };

      try {
        await runOpenRouterAgentLoop(
          conversation,
          resolvedApiKey,
          systemPrompt,
          paperContext,
          parsedPaper,
          tools,
          toolContext,
          emit,
          body.mode === "discover"
            ? {
                requiredFinalTool: {
                  name: "submit_picks",
                  nudge:
                    "You gathered search results and read candidates but never called submit_picks, so the user would see nothing. Call submit_picks NOW with the 4–6 strongest candidates (fewer if the pool is small) — each with a one-sentence rationale and a canonical URL. Then write the explainer paragraph. Do not ask a question or stop; submit the picks.",
                  maxNudges: 2,
                },
              }
            : undefined,
        );
      } catch (err) {
        const rateLimited = !!(err as { isRateLimit?: boolean })?.isRateLimit;
        emit(
          rateLimited
            ? {
                type: "error",
                code: "rate_limit",
                message:
                  "You've reached the current usage limit. Add your own OpenRouter key for higher limits.",
              }
            : {
                type: "error",
                message: err instanceof Error ? err.message : "Unknown error",
              },
        );
      }

      // Persist the turn (best-effort) AFTER streaming, so it never delays the
      // first token — this is also where the one Slack notification fires. The
      // user message is always written (the server didn't store it up front);
      // the assistant reply is appended only when the turn produced text, so
      // an Exa-key pause or hard error leaves just the user message and a
      // resume re-runs cleanly.
      if (persist) {
        const content = stepsToContent(steps);
        let finalMessages = persist.base;
        if (content.trim()) {
          const blocks = stepsToBlocks(steps);
          const assistantMsg: ChatMessage = {
            id: assistantMessageId || crypto.randomUUID(),
            role: "assistant",
            content,
            timestamp: new Date().toISOString(),
            ...(blocks.length > 0 ? { blocks } : {}),
          };
          finalMessages = [...persist.base, assistantMsg];
        }
        try {
          await store.setMessages(
            persist.userId,
            persist.reviewId,
            finalMessages,
          );
        } catch (e) {
          // Non-fatal: the client already has the turn on screen. Worst case
          // it's missing on next load; better than failing the request.
          console.error("Failed to persist chat turn:", e);
        }
      }

      emit({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
