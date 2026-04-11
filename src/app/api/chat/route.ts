/**
 * Agentic chat endpoint.
 *
 * Implements a server-side ReAct loop: the LLM can call tools (arXiv search,
 * web search, ranking, etc.) as many times as needed, and the loop feeds
 * results back until the LLM produces a final text response.
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
import { getInferenceProfile } from "@/lib/server/store";
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

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  model: string;
  provider: Provider;
  /** Required for built-in providers; ignored when `profileId` resolves credentials. */
  apiKey?: string;
  /** Inference profile id (OpenAI-compatible); server loads key and base URL. */
  profileId?: string;
  /** @deprecated use profileId for inference providers */
  apiBaseUrl?: string;
  paperContext?: string;
  paperTitle?: string;
  arxivId?: string;
  reviewId?: string;
  /** Set when the review is for an arbitrary web page rather than a paper/PDF. */
  sourceUrl?: string;
  /** Chat mode: "paper" (default), "web", or "kb" for Knowledge Base chat. */
  chatMode?: "paper" | "web" | "kb";
}

/* ------------------------------------------------------------------ */
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

const PAPER_SYSTEM_PROMPT = `You are a superintelligent research assistant embedded in a paper reading tool. You have deep expertise across all academic fields — machine learning, mathematics, physics, biology, and beyond.

Your mission: help the user deeply understand the paper they are reading and the ideas surrounding it. You can explain, search, discover, and connect ideas.

Capabilities:
- You have the full text of the paper in context (when available)
- You can search arXiv to find related papers, prerequisites, and seminal references
- You can search the web to ground your answers with real sources and documentation
- You can rank and filter search results to find the most relevant ones
- You can save related papers to the knowledge graph so they persist in the Discovery tab for later exploration

Guidelines:
- Cite specific sections, equations, figures, or theorems from the paper when relevant
- Use LaTeX notation for math (wrapped in $ or $$)
- When asked about prerequisites, related work, or the research landscape, proactively use your search tools to find real papers — don't just rely on your training data
- When explaining highly technical concepts, consider searching for authoritative explanations to ground your answer
- Be precise and dense with insight — researchers value depth over verbosity
- When you find relevant papers via search, include arXiv links (https://arxiv.org/abs/ID)
- When you find related papers (especially for "related work" or "prerequisite" queries), use save_to_knowledge_graph to persist them so the user can explore the relationship map in the Discovery tab
- Use tools when they add value, but don't force tool use for simple questions you can answer directly from the paper context
- You have access to the user's Knowledge Base — a personal wiki of compiled concepts, methods, and results from everything they've read
- Use query_knowledge_base to check what the user already knows before explaining a topic from scratch
- Use update_knowledge_base to save important concepts, methods, or insights as you encounter them in conversation
- When creating KB pages, use [[slug]] syntax for cross-references to other KB pages
- Prefer updating existing pages over creating duplicates — check first with query_knowledge_base`;

const WEB_SYSTEM_PROMPT = `You are a superintelligent research assistant embedded in a reading and analysis tool. You have deep expertise across all domains — technology, science, business, humanities, and beyond.

Your mission: help the user deeply understand the web page they are reading, explore related topics, and connect ideas.

Capabilities:
- You have the full extracted text of the web page in context (when available)
- You can search arXiv to find academic papers related to the content
- You can search the web to find additional sources, context, and related material
- You can rank and filter search results to find the most relevant ones
- You can save related papers to the knowledge graph so they persist in the Discovery tab for later exploration

Guidelines:
- Reference specific passages, claims, or sections from the page when relevant
- Use LaTeX notation for math when applicable (wrapped in $ or $$)
- When asked about related research, proactively use your search tools — don't just rely on your training data
- When explaining technical concepts, consider searching for authoritative explanations to ground your answer
- Be precise and dense with insight — readers value depth over verbosity
- When you find relevant papers via search, include arXiv links (https://arxiv.org/abs/ID)
- When you find related papers, use save_to_knowledge_graph to persist them so the user can explore the relationship map in the Discovery tab
- Use tools when they add value, but don't force tool use for simple questions you can answer directly from the page context
- You have access to the user's Knowledge Base — a personal wiki of compiled concepts, methods, and results from everything they've read
- Use query_knowledge_base to check what the user already knows before explaining a topic from scratch
- Use update_knowledge_base to save important concepts, methods, or insights as you encounter them in conversation
- When creating KB pages, use [[slug]] syntax for cross-references to other KB pages
- Prefer updating existing pages over creating duplicates — check first with query_knowledge_base`;

const KB_SYSTEM_PROMPT = `You are a knowledge base librarian and research assistant. You maintain and query the user's personal Knowledge Base — a wiki of compiled concepts, methods, results, and paper summaries built from their research reading.

Capabilities:
- You can search the KB to answer questions about what the user has learned
- You can create new wiki pages for topics, concepts, methods, and results
- You can update existing pages with corrections, clarifications, or new connections
- You can find gaps, contradictions, and opportunities to strengthen the KB
- You can search arXiv and the web to enrich KB pages with new information

Guidelines:
- When answering questions, always check the KB first via query_knowledge_base
- Synthesize across multiple KB pages when the user asks cross-cutting questions
- When updating pages, preserve existing content and add new information with clear attribution
- Use [[slug]] syntax for cross-references between pages
- Use LaTeX notation for math (wrapped in $ or $$)
- Be a disciplined librarian: maintain consistency, flag contradictions, keep pages well-organized
- When you find relevant papers via search, include arXiv links (https://arxiv.org/abs/ID)
- Use tools when they add value, but don't force tool use for simple questions you can answer from the KB`;

function getSystemPrompt(sourceUrl?: string, chatMode?: string): string {
  if (chatMode === "kb") return KB_SYSTEM_PROMPT;
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
    profileId,
    apiBaseUrl,
    paperContext,
    paperTitle,
    arxivId,
    reviewId,
    sourceUrl,
    chatMode,
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

  let effectiveApiKey = typeof apiKey === "string" ? apiKey : "";
  let effectiveBaseUrl =
    typeof apiBaseUrl === "string" ? apiBaseUrl.trim() : "";
  let profileSupportsStreaming = true;

  if (isInferenceProviderType(provider)) {
    if (!profileId || typeof profileId !== "string" || !profileId.trim()) {
      return jsonError("profileId is required for inference providers.", 400);
    }
    const prof = getInferenceProfile(profileId.trim());
    if (!prof) {
      return jsonError("Unknown inference profile.", 404);
    }
    if (prof.kind !== provider) {
      return jsonError("Inference profile does not match provider type.", 400);
    }
    if (!prof.apiKey?.trim() || !prof.baseUrl?.trim()) {
      return jsonError("Inference profile is missing API key or base URL.", 400);
    }
    effectiveApiKey = prof.apiKey;
    effectiveBaseUrl = prof.baseUrl.trim();
    profileSupportsStreaming = prof.supportsStreaming !== false;
  } else if (!effectiveApiKey.trim()) {
    return jsonError("API key is required.", 401);
  }

  const tools = getAllTools();
  const toolContext: ToolContext = { paperContext, paperTitle, arxivId, reviewId };
  const systemPrompt = getSystemPrompt(sourceUrl, chatMode);
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
