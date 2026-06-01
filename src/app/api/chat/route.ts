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
import type { Provider } from "@/lib/models";
import { isInferenceProviderType, contextWindowFor } from "@/lib/models";
import {
  invalidApiProviderMessage,
  isAnthropicMessagesProvider,
  isProvider,
  type OpenAiCompatibleProvider,
} from "@/lib/ai-providers";
import type { StreamEvent } from "@/lib/stream-types";
import { jsonError } from "@/lib/api-utils";
import { resolveServerApiKey } from "@/server/provider-env";
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
import { runAnthropicAgentLoop } from "./anthropic-handler";
import { runOpenAIAgentLoop } from "./openai-handler";
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
  model: string;
  provider: Provider;
  /** Required. Sent inline from the browser; never persisted server-side. */
  apiKey: string;
  /** Base URL for OpenAI-compatible providers. */
  apiBaseUrl?: string;
  /** Whether the OpenAI-compatible endpoint supports streaming. Default: true. */
  supportsStreaming?: boolean;
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
- ${PICKS_FORMAT}`;

  return [
    role,
    sourceInContext,
    tools,
    KNOWLEDGE_FIRST,
    grounding,
    LENGTH_AND_TONE,
    format,
    NEVER_INVENT,
  ].join("\n\n");
}

const PAPER_SYSTEM_PROMPT = buildReadingPrompt("paper");
const WEB_SYSTEM_PROMPT = buildReadingPrompt("web");

const DISCOVERY_SYSTEM_PROMPT = `You are a research discovery agent. Find research material worth reading for the user's query — primarily papers from arXiv and Semantic Scholar, but ALSO high-signal web sources (lab blog posts, technical writeups from researchers/companies, official documentation, authoritative survey articles) when those would serve the user better than the available academic papers. Submit them via the \`submit_picks\` tool.

Web sources are first-class picks, not a fallback. For practical/engineering topics ("deterministic LLM training", "RAG eval setup", "vLLM tuning"), a well-written lab blog post or technical writeup often beats an academic paper. Don't reflexively reach for arXiv when the better resource is on the web.

You act across multiple rounds. Each round you must produce *something*: tool calls, a clarifying question, or a refusal text. Empty or near-empty turns between rounds end the loop and leave the user with nothing — never do that.

Procedure (each round produces output; do not stop until \`submit_picks\` is called or you've emitted a refusal text):

ROUND 1 — SEARCH. In parallel, run BOTH:
  - 1–4 \`arxiv_search\` calls using concrete keywords for distinct angles. Covers Semantic Scholar's broad academic index — arXiv plus major venues.
  - 1–2 \`web_search\` calls to surface lab blogs, technical writeups, and grey literature. Don't gate this — run web_search by default unless the query is clearly purely academic ("speculative decoding 2024 NeurIPS papers"). Note the contrast in query style: \`arxiv_search\` takes concrete keywords, while \`web_search\` (Exa, neural) takes a natural-language description of what a good result would look like ("an engineering blog post on tuning vLLM throughput for long contexts").
  If \`web_search\` returns "EXA_KEY_REQUIRED" the UI handles it — continue with arXiv results. Plan your sub-queries internally; do NOT emit a visible Plan list.

ROUND 1B — BROADEN (only if every round 1 search returned 0 results). If every \`arxiv_search\` came back "No papers found" and every \`web_search\` came back empty too, you MUST run another round of 2–3 \`arxiv_search\` calls with substantially DIFFERENT terminology before refusing. The first round may have used the user's exact jargon; this round explores adjacent vocabulary. Examples of broadening moves:
  - Replace specific terminology with the canonical academic term ("bitwise determinism" → "deterministic training", "reproducibility").
  - Drop one or two highly specific tokens to widen the net.
  - Search for the broader research area ("LLM training reproducibility" → "reproducibility in deep learning").
  - Search for the underlying problem instead of the proposed solution.
  Only refuse (per ROUND 2(c) below) if THIS round also returns nothing usable. Do NOT skip 1B and refuse on round 1 alone.

ROUND 2 — VERIFY (or REFUSE). Inspect the search results you've gathered. THREE possible actions, in priority order:
  (a) If you have ≥3 plausible candidates, call \`paper_details\` on the top 6–10 arXiv candidates in parallel. (\`paper_details\` only works for arXiv ids — for web candidates, use the search snippet directly; no separate verification call.) This is the default path. Even when results are weak, prefer to verify and surface adjacent work.
  (b) If you have 1–2 plausible candidates, still verify any arXiv ones, and proceed to submit them as soft picks (label them as "closest available" in the rationale).
  (c) ONLY if rounds 1 and 1B BOTH returned literally zero results across all queries (no arXiv papers AND no web results): emit a 1–2 sentence refusal text saying so and suggesting a reformulation. Do NOT call \`submit_picks\` with empty picks.

ROUND 3 — SUBMIT. Call \`submit_picks\` ONCE with 5–7 picks (or fewer if the candidate pool was small). Each pick can be an arXiv paper OR a high-signal web source — mix freely. Each rationale is one sentence grounded in evidence: for arXiv picks, the verified TLDR/abstract; for web picks, the search-result description. Describe what the source actually contributes, not a paraphrase of the title. Use the canonical URL (arXiv abs URL for papers; the source URL for web picks). Set \`arxivId\` only for arXiv picks; omit it for web sources.

ROUND 4 — CONFIRM. After \`submit_picks\` returns, reply with a one-line confirmation ("Picks submitted.") and stop.

Hard rules:
- After every tool result you receive, your next turn MUST contain either more tool calls or a refusal text. Never end a round empty.
- Never refuse after a single search round. Always broaden once first (round 1B) before considering refusal.
- If you write text in a turn, the corresponding tool calls (if any) MUST live in the same response.
- For paper_details, you can pass either an arxiv id ("2401.12345") or the full URL — the tool accepts both.
- Only ask a clarifying question when the query is a single bare word with no named method, task, or approach attached (e.g. "AI", "transformers", "RAG"). In that case ask exactly one clarifying question on round 1 and stop. Multi-word technical topics like "diffusion transformers", "speculative decoding", or "test-time compute" are NOT ambiguous — search them. Ambiguity between sub-angles (foundational vs. engineering, image vs. video, theory vs. SOTA) is also not a reason to ask: cover the dominant angles across your picks instead.
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
    model,
    provider,
    apiKey,
    apiBaseUrl,
    supportsStreaming,
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

  if (!isProvider(provider)) {
    return jsonError(invalidApiProviderMessage(), 400);
  }
  if (!model || typeof model !== "string") {
    return jsonError("Model ID is required.", 400);
  }

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

  const effectiveApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const effectiveBaseUrl =
    typeof apiBaseUrl === "string" ? apiBaseUrl.trim() : "";
  const profileSupportsStreaming = supportsStreaming !== false;

  // For built-in providers, fall back to the platform key when the user
  // didn't bring their own. Never echoed back — used only upstream below.
  const resolvedApiKey = isInferenceProviderType(provider)
    ? effectiveApiKey
    : resolveServerApiKey(provider, effectiveApiKey) ?? "";

  // OpenAI-compatible providers may be unauthenticated (localhost Ollama, or
  // a tunnel fronting one). If the upstream actually requires a key, it will
  // 401 and we surface that error — better than blocking valid setups here.
  if (!resolvedApiKey && !isInferenceProviderType(provider)) {
    return jsonError("API key is required.", 401);
  }
  if (isInferenceProviderType(provider) && !effectiveBaseUrl) {
    return jsonError(
      "apiBaseUrl is required for OpenAI-compatible providers.",
      400,
    );
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
        contextWindowFor(provider, model) - 16_384 - overhead - 2_000;
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
        if (isAnthropicMessagesProvider(provider)) {
          await runAnthropicAgentLoop(
            conversation,
            model,
            resolvedApiKey,
            systemPrompt,
            paperContext,
            parsedPaper,
            tools,
            toolContext,
            emit,
          );
        } else {
          await runOpenAIAgentLoop(
            conversation,
            model,
            resolvedApiKey,
            systemPrompt,
            paperContext,
            parsedPaper,
            provider as OpenAiCompatibleProvider,
            tools,
            toolContext,
            emit,
            provider === "openai_compatible"
              ? {
                  customOpenAiBaseUrl: effectiveBaseUrl,
                  supportsStreaming: profileSupportsStreaming,
                }
              : undefined,
          );
        }
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
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
