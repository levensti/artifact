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
import { isInferenceProviderType } from "@/lib/models";
import {
  invalidApiProviderMessage,
  isAnthropicMessagesProvider,
  isProvider,
  type OpenAiCompatibleProvider,
} from "@/lib/ai-providers";
import type { StreamEvent } from "@/lib/stream-types";
import { jsonError } from "@/lib/api-utils";
import { getAllTools } from "@/tools/registry";
import type { ToolContext } from "@/tools/types";
import { runAnthropicAgentLoop } from "./anthropic-handler";
import { runOpenAIAgentLoop } from "./openai-handler";
import type { ParsedPaper } from "@/lib/review-types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
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
   * User-provided Brave Search API key. When absent the `web_search` tool
   * returns a sentinel that the chat UI surfaces as a configure card.
   */
  braveSearchApiKey?: string;
  /**
   * Set when the user has explicitly dismissed the "configure Brave key"
   * card and wants the agent to proceed without web search. The chat
   * handler unregisters `web_search` for the turn so the agent doesn't
   * attempt it again.
   */
  skipWebSearch?: boolean;
}

/* ------------------------------------------------------------------ */
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

const PAPER_SYSTEM_PROMPT = `You are a research assistant working alongside someone reading an academic paper. Your job: help them understand the paper deeply and the ideas around it — explain, search, discover, connect.

How the paper appears in your context:
- For short papers, the <paper> block contains the full text. Read it directly.
- For long papers, the <paper> block contains only the title, abstract, an L1 summary, and a numbered table of contents. Use \`read_section\` (by name or index), \`search_paper\` (to find passages by query), or \`lookup_citation\` (to resolve a reference) to fetch specific content. Don't pretend to read what you haven't fetched — if the summary doesn't cover a question, fetch the relevant section.

Tools:
- \`read_section\`, \`search_paper\`, \`lookup_citation\` — paper-internal content (long-paper mode)
- \`arxiv_search\` — find related papers, prerequisites, or specific cited works
- \`web_search\` — ground claims with real sources and current documentation. If it returns "BRAVE_KEY_REQUIRED", the UI is already prompting the user to add a key — do NOT verbalize the failure; continue with what you have from the paper, training, and arXiv.

Citations:
- Cite the paper inline for every distinct statement you make about it. Each one gets its own locator. Don't bundle multiple statements behind a single trailing reference.
- Sections: write "(§N)", "(§N.M)", or "(§N.M.K)". Always cite at the deepest subsection level that actually grounds the claim. Prefer "(§4.2.1)" over "(§4.2)" when the statement comes from that subsection specifically.
- Figures: write "(Fig. N)" — e.g. "(Fig. 3)" or "(Fig. 3.2)". For multi-panel figures, cite the parent number and describe the panel in prose ("the right panel of (Fig. 3) shows..."), not "(Fig. 3a)".
- Tables: write "(Table N)" — e.g. "(Table 1)". Tables are dense, so always pair the citation with the specific row, column, or comparison you want the reader to focus on ("the 'GLUE avg.' column of (Table 2)").

When NOT to search:
- The paper context already covers the question
- It's a well-known concept you can explain from training (e.g., "what is softmax", "how does backprop work")
- You're only confirming something you're already confident about

When TO search:
- The user asks for prerequisites, related work, or the research landscape — use \`arxiv_search\` rather than guessing from training data
- You're resolving a specific reference or paper the user names
- A claim is non-obvious or current and a citable source materially helps the answer

Don't run multiple searches when one would do. Don't search to pad an answer.

Length — match the answer to the question. There is no target length.
- Clarifications and definitions usually take 1–3 sentences.
- Focused questions ("what's the key claim?", "summarize §3") usually take a tight paragraph.
- Walkthroughs ("explain the method end-to-end", "compare to prior work") take structured multi-paragraph prose with equations and refs.

Don't restate the question, don't preface with "Great question", don't add caveats unless they actually matter. Be selective — surface what matters for this question, not everything you know.

Format:
- Math: LaTeX wrapped in $ (inline) or $$ (block).
- Anchor every claim about the paper's content with a reference: (§N) for sections, (Fig. N) for figures, (Eq. N) for equations, (Ref. [key]) for references. These auto-render as clickable nav chips.
- When the user starts a thread from a quoted passage, ground your answer in that passage and the section it comes from.
- For arXiv papers found via search, include the link https://arxiv.org/abs/ID.
- Default to prose. Use lists or headers only when the answer is genuinely list-shaped (comparing N items, an M-step walkthrough).
- When the user explicitly asks for a list of papers to read (e.g. "find related work on X", "what should I read after this?"), emit a curated list under a \`**Picks**\` heading: 3–7 numbered items, each as \`**[Title](https://arxiv.org/abs/ID)** — one sentence on why it fits.\` (No abstract paraphrase, no author/year/venue — those render as a card around the link.) Don't use the Picks format for normal explanatory answers.`;

const DISCOVERY_SYSTEM_PROMPT = `You are a research discovery agent. Find research material worth reading for the user's query — primarily papers from arXiv and Semantic Scholar, but ALSO high-signal web sources (lab blog posts, technical writeups from researchers/companies, official documentation, authoritative survey articles) when those would serve the user better than the available academic papers. Submit them via the \`submit_picks\` tool.

Web sources are first-class picks, not a fallback. For practical/engineering topics ("deterministic LLM training", "RAG eval setup", "vLLM tuning"), a well-written lab blog post or technical writeup often beats an academic paper. Don't reflexively reach for arXiv when the better resource is on the web.

You act across multiple rounds. Each round you must produce *something*: tool calls, a clarifying question, or a refusal text. Empty or near-empty turns between rounds end the loop and leave the user with nothing — never do that.

Procedure (each round produces output; do not stop until \`submit_picks\` is called or you've emitted a refusal text):

ROUND 1 — SEARCH. In parallel, run BOTH:
  - 1–4 \`arxiv_search\` calls using concrete keywords for distinct angles. Covers Semantic Scholar's broad academic index — arXiv plus major venues.
  - 1–2 \`web_search\` calls to surface lab blogs, technical writeups, and grey literature. Don't gate this — run web_search by default unless the query is clearly purely academic ("speculative decoding 2024 NeurIPS papers").
  If \`web_search\` returns "BRAVE_KEY_REQUIRED" the UI handles it — continue with arXiv results. Plan your sub-queries internally; do NOT emit a visible Plan list.

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
- If the user's query is genuinely ambiguous (one bare word, no method or task), ask exactly one clarifying question on round 1 and stop. Do not search.
- Never invent papers, URLs, or arXiv IDs.

Tone: dense, librarian-level. Technical user.`;

const WEB_SYSTEM_PROMPT = `You are a superintelligent research assistant embedded in a reading and analysis tool. You have deep expertise across all domains — technology, science, business, humanities, and beyond.

Your mission: help the user deeply understand the web page they are reading, explore related topics, and connect ideas.

Capabilities:
- You have the full extracted text of the web page in context (when available)
- You can search arXiv to find academic papers related to the content
- You can search the web to find additional sources, context, and related material. If web_search returns "BRAVE_KEY_REQUIRED", the UI is already prompting the user to add a key — do NOT verbalize the failure; just continue with what you have.

Guidelines:
- Reference specific passages, claims, or sections from the page when relevant
- Use LaTeX notation for math when applicable (wrapped in $ or $$)
- When asked about related research, proactively use your search tools — don't just rely on your training data
- When explaining technical concepts, consider searching for authoritative explanations to ground your answer
- Be precise and dense with insight — readers value depth over verbosity
- When you find relevant papers via search, include arXiv links (https://arxiv.org/abs/ID)
- Use tools when they add value, but don't force tool use for simple questions you can answer directly from the page context`;

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
    braveSearchApiKey,
    skipWebSearch,
    mode,
  } = body;

  if (!isProvider(provider)) {
    return jsonError(invalidApiProviderMessage(), 400);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError("Messages array is required and must not be empty.", 400);
  }
  if (!model || typeof model !== "string") {
    return jsonError("Model ID is required.", 400);
  }

  const effectiveApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const effectiveBaseUrl =
    typeof apiBaseUrl === "string" ? apiBaseUrl.trim() : "";
  const profileSupportsStreaming = supportsStreaming !== false;

  // OpenAI-compatible providers may be unauthenticated (localhost Ollama, or
  // a tunnel fronting one). If the upstream actually requires a key, it will
  // 401 and we surface that error — better than blocking valid setups here.
  if (!effectiveApiKey && !isInferenceProviderType(provider)) {
    return jsonError("API key is required.", 401);
  }
  if (isInferenceProviderType(provider) && !effectiveBaseUrl) {
    return jsonError(
      "apiBaseUrl is required for OpenAI-compatible providers.",
      400,
    );
  }

  const trimmedBraveKey =
    typeof braveSearchApiKey === "string" ? braveSearchApiKey.trim() : "";
  // Always register all tools — web_search included. When the user has no
  // Brave key, the tool returns a sentinel that the chat UI surfaces as an
  // inline "Add Brave Search API key" card rather than the agent verbalizing
  // the failure. The exception: if the user dismissed the card, we drop
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
    braveSearchApiKey: trimmedBraveKey || undefined,
  };
  const systemPrompt = getSystemPrompt(sourceUrl, mode);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* controller may be closed */
        }
      };

      try {
        if (isAnthropicMessagesProvider(provider)) {
          await runAnthropicAgentLoop(
            messages,
            model,
            effectiveApiKey,
            systemPrompt,
            paperContext,
            parsedPaper,
            tools,
            toolContext,
            emit,
          );
        } else {
          await runOpenAIAgentLoop(
            messages,
            model,
            effectiveApiKey,
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
