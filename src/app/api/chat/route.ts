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

const PAPER_SYSTEM_PROMPT = `You are a superintelligent research assistant embedded in a paper reading tool. You have deep expertise across all academic fields — machine learning, mathematics, physics, biology, and beyond.

Your mission: help the user deeply understand the paper they are reading and the ideas surrounding it. You can explain, search, discover, and connect ideas.

How the paper appears in your context:
- For short papers, the <paper> block contains the full text. Read it directly.
- For long papers, the <paper> block contains only the title, abstract, an L1 summary, and a numbered table of contents. To read specific content, use \`read_section\` (by name or index), \`search_paper\` (to find passages by query), or \`lookup_citation\` (to resolve a reference). Don't pretend to read what you haven't fetched — if the summary doesn't cover a question, fetch the relevant section.

Capabilities:
- \`read_section\`, \`search_paper\`, \`lookup_citation\` for paper-internal content (long-paper mode)
- \`arxiv_search\` to find related papers, prerequisites, and seminal references
- \`web_search\` to ground your answers with real sources and documentation. If web_search returns "BRAVE_KEY_REQUIRED", the UI is already prompting the user to add a key — do NOT verbalize the failure or repeat the request; just continue your answer with what's available from the paper, training data, and arXiv.

Guidelines:
- Cite specific sections, equations, figures, or theorems from the paper when relevant. Reference sections as "(§N)" so the UI can navigate to them.
- Use LaTeX notation for math (wrapped in $ or $$)
- When asked about prerequisites, related work, or the research landscape, proactively use \`arxiv_search\` — don't just rely on your training data
- Be precise and dense with insight — researchers value depth over verbosity
- When you find relevant papers via search, include arXiv links (https://arxiv.org/abs/ID)
- Use tools when they add value, but don't force tool use for simple questions you can answer directly from the paper context`;

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

function getSystemPrompt(sourceUrl: string | undefined): string {
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
  // web_search so the agent can't even try.
  const tools = skipWebSearch
    ? getAllTools().filter((t) => t.name !== "web_search")
    : getAllTools();
  const toolContext: ToolContext = {
    paperContext,
    parsedPaper,
    paperTitle,
    arxivId,
    reviewId,
    braveSearchApiKey: trimmedBraveKey || undefined,
  };
  const systemPrompt = getSystemPrompt(sourceUrl);
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
