/**
 * Project-level chat endpoint.
 *
 * Builds a multi-paper "manifest" context for the project (titles + arXiv
 * IDs + web URLs) and delegates to the same agent loop used by per-paper
 * chat. This is intentionally a v0: the agent does NOT get per-paper
 * section-retrieval tools — those are tied to a single ParsedPaper. It
 * gets `arxiv_search`, `web_search`, and the manifest, and uses them to
 * answer cross-paper questions.
 *
 * Per-paper section retrieval (`get_paper`, `read_section_in_paper`)
 * requires a Review→ParsedPaper link in the schema and a project-aware
 * tool surface; that's Phase 3.
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
import { runAnthropicAgentLoop } from "@/app/api/chat/anthropic-handler";
import { runOpenAIAgentLoop } from "@/app/api/chat/openai-handler";
import { requireUserId, errorResponse } from "@/server/api";
import { getProject } from "@/server/projects";
import { getReview } from "@/server/store";

interface ProjectChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  model: string;
  provider: Provider;
  apiKey: string;
  apiBaseUrl?: string;
  supportsStreaming?: boolean;
  braveSearchApiKey?: string;
  skipWebSearch?: boolean;
}

const PROJECT_SYSTEM_PROMPT = `You are a superintelligent research assistant for a multi-paper research project. The user has gathered several papers under one project and is asking questions that span them.

How the project appears in your context:
- The <project> block names the project and (optionally) its description.
- The <papers> block enumerates every paper currently in the project, each with its arXiv id (when available), title, and source URL (for web pages).
- You do NOT have the full text of these papers preloaded. To dig in:
  - Use \`arxiv_search\` (with the arXiv id or distinctive title fragments) to fetch abstracts and find related work.
  - Use \`web_search\` for non-arXiv sources, blog posts, and recent context.
  - When a question genuinely needs body-level detail from a specific paper, say so plainly — the user can open that paper directly for a deeper read.

Guidelines:
- Compare and contrast across papers when the question invites it. Cite by paper title or "[paper N]" referring to the manifest order.
- When papers conflict, surface the disagreement explicitly rather than averaging it away.
- Use LaTeX (\`$...$\` / \`$$...$$\`) for math.
- If \`web_search\` returns "BRAVE_KEY_REQUIRED", the UI is already prompting; don't repeat the request, just continue with what's available.
- Be precise and dense; researchers value depth over verbosity.`;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  let body: ProjectChatRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    return errorResponse(err);
  }

  const { id: projectId } = await ctx.params;
  const project = await getProject(userId, projectId);
  if (!project) return jsonError("Project not found", 404);

  const {
    messages,
    model,
    provider,
    apiKey,
    apiBaseUrl,
    supportsStreaming,
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

  if (!effectiveApiKey && !isInferenceProviderType(provider)) {
    return jsonError("API key is required.", 401);
  }
  if (isInferenceProviderType(provider) && !effectiveBaseUrl) {
    return jsonError(
      "apiBaseUrl is required for OpenAI-compatible providers.",
      400,
    );
  }

  // Resolve member review rows (parallel) so we can build the manifest
  // string. Skip any IDs that no longer resolve (race with deletion) so
  // we never embed a "ghost" reference.
  const memberRows = await Promise.all(
    project.reviewIds.map((id) => getReview(userId, id)),
  );
  const members = memberRows.filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );

  const manifest = buildProjectManifest(project, members);

  const trimmedBraveKey =
    typeof braveSearchApiKey === "string" ? braveSearchApiKey.trim() : "";

  // Drop the paper-internal tools — they assume a single ParsedPaper
  // and have no concept of "which paper". Web/arxiv search remain.
  const PAPER_PARSED_TOOLS = new Set([
    "read_section",
    "search_paper",
    "lookup_citation",
  ]);
  const tools = getAllTools().filter((t) => {
    if (skipWebSearch && t.name === "web_search") return false;
    if (PAPER_PARSED_TOOLS.has(t.name)) return false;
    return true;
  });

  const toolContext: ToolContext = {
    paperContext: manifest,
    parsedPaper: undefined,
    paperTitle: project.name,
    arxivId: undefined,
    reviewId: undefined,
    braveSearchApiKey: trimmedBraveKey || undefined,
  };

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
            PROJECT_SYSTEM_PROMPT,
            manifest,
            undefined,
            tools,
            toolContext,
            emit,
          );
        } else {
          await runOpenAIAgentLoop(
            messages,
            model,
            effectiveApiKey,
            PROJECT_SYSTEM_PROMPT,
            manifest,
            undefined,
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

function buildProjectManifest(
  project: { name: string; description: string | null; notes: string | null },
  reviews: {
    title: string;
    arxivId: string | null;
    sourceUrl: string | null;
  }[],
): string {
  const lines: string[] = [];
  lines.push("<project>");
  lines.push(`<name>${escapeXml(project.name)}</name>`);
  if (project.description) {
    lines.push(`<description>${escapeXml(project.description)}</description>`);
  }
  if (project.notes && project.notes.trim()) {
    lines.push(
      `<notes>\n${escapeXml(project.notes.trim())}\n</notes>`,
    );
  }
  lines.push("</project>");
  lines.push("<papers>");
  if (reviews.length === 0) {
    lines.push(
      "(empty — the user hasn't added any papers yet. Tell them so plainly.)",
    );
  } else {
    reviews.forEach((r, i) => {
      const idx = i + 1;
      const idTag = r.arxivId
        ? ` arxiv="${r.arxivId}"`
        : r.sourceUrl
          ? ` url="${escapeXml(r.sourceUrl)}"`
          : "";
      lines.push(
        `<paper n="${idx}"${idTag}>${escapeXml(r.title)}</paper>`,
      );
    });
  }
  lines.push("</papers>");
  return lines.join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
