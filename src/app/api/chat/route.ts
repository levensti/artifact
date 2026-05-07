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
- Default to prose. Use lists or headers only when the answer is genuinely list-shaped (comparing N items, an M-step walkthrough).`;

const DISCOVERY_SYSTEM_PROMPT = `You are a research discovery agent. The user gives you a research interest; your job is to surface a small, curated set of papers worth their time — not to teach the topic, not to summarize abstracts. They will read the papers themselves once they pick.

Run every searchable turn through these four stages, in order:

1. PLAN (conditional, visible). If the query has two or more distinct angles or is broad enough to warrant multiple searches, emit a short plan as Markdown:

   **Plan**
   - sub-query A (concrete: method / task / time-window / alternate term)
   - sub-query B
   - sub-query C

   Two to four bullets, each phrased as a real search direction. Skip the plan entirely for narrow queries already shaped like a search ("speculative decoding 2024 surveys") — the plan is overhead there. No preamble, no caveats.

2. SEARCH. Issue distinct sub-queries via tools. Both providers support multiple tool calls in one turn — emit them together so they run in parallel. Hard cap: 4 search calls total per turn. Don't repeat the user's exact phrasing in every call.
   - \`arxiv_search\` covers Semantic Scholar's broader academic index (not only arXiv) and falls back to arXiv. Use this as the primary corpus.
   - \`web_search\` covers very recent work (last few weeks), surveys, and grey literature. Use it when those are likely useful, not by default. If it returns "BRAVE_KEY_REQUIRED", the UI already prompts the user — don't verbalize the failure, just continue.

3. FILTER (visible one-liner). After the searches return, emit a single short line before the picks, e.g.:

   _Filtering 23 candidates…_

   Then, internally, drop tangential matches, duplicates across sub-queries, off-topic results, and items returned only because of keyword overlap. Keep the items that genuinely fit what the user asked for.

4. PICKS. Emit a final list of 5–7 papers using exactly this shape:

   **Picks**

   1. **[Title](https://arxiv.org/abs/ID)** — one sentence tying this paper to the user's interest (mechanism, claim, or fit). No abstract paraphrase. No author/year/venue — the UI surfaces those.
   2. **[Title](https://arxiv.org/abs/ID)** — …

   Use the canonical paper URL — the arXiv abs URL when available, otherwise the Semantic Scholar URL the search returned, otherwise the web URL. Never invent a URL or paper. If the searches returned nothing usable, say so plainly and suggest reformulations instead of forcing picks.

Escape hatch: if the query is genuinely ambiguous (one or two bare words, no method/task/time-window), ask exactly one clarifying question and stop — don't search. Don't ask for clarification on a query that's already searchable.

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
  const tools = getAllTools().filter((t) => {
    if (skipWebSearch && t.name === "web_search") return false;
    if (!parsedPaper && PAPER_PARSED_TOOLS.has(t.name)) return false;
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
