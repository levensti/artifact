/**
 * Tool: update_knowledge_base
 *
 * Creates or updates a wiki page in the persistent knowledge base.
 * The assistant uses this to save explanations, concepts, and paper
 * information so knowledge compounds across sessions.
 */

import type { ToolDefinition, ToolContext } from "./types";
import {
  upsertWikiPage,
  addWikiPageSource,
  getWikiPageBySlug,
} from "@/lib/server/store";
import type { WikiPageType } from "@/lib/wiki";

const VALID_TYPES = new Set<WikiPageType>([
  "paper",
  "concept",
  "method",
  "entity",
  "graph",
]);

export const updateWikiTool: ToolDefinition = {
  name: "update_knowledge_base",
  description:
    "Create or update a page in the persistent knowledge base wiki. Use this to save explanations, concept definitions, paper summaries, and method descriptions so they persist across sessions. " +
    "Use [[slug]] syntax in content to cross-reference other knowledge base pages. " +
    "If a page with the given slug already exists, it will be overwritten — read it first with query_knowledge_base if you want to preserve existing content.",
  parameters: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description:
          'URL-friendly page identifier (lowercase, hyphens, no spaces). Example: "multi-head-attention"',
      },
      title: {
        type: "string",
        description: "Human-readable page title. Example: \"Multi-Head Attention\"",
      },
      content: {
        type: "string",
        description:
          "Full markdown content for the page. Use [[slug]] to link to other pages. Use $..$ for inline math and $$...$$ for display math.",
      },
      page_type: {
        type: "string",
        description:
          'Page category: "paper" (paper summary), "concept" (technical concept), "method" (algorithm/technique), "entity" (author/dataset/org), "graph" (paper relationships).',
        enum: ["paper", "concept", "method", "entity", "graph"],
      },
    },
    required: ["slug", "title", "content", "page_type"],
  },

  async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const slug = String(input.slug ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "");
    const title = String(input.title ?? "").trim();
    const content = String(input.content ?? "").trim();
    const pageType = String(input.page_type ?? "concept") as WikiPageType;

    if (!slug) return "Error: slug is required.";
    if (!title) return "Error: title is required.";
    if (!content) return "Error: content is required.";
    if (!VALID_TYPES.has(pageType)) {
      return `Error: invalid page_type "${pageType}". Must be one of: paper, concept, method, entity, graph.`;
    }

    const existing = getWikiPageBySlug(slug);
    const id = existing?.id ?? crypto.randomUUID();

    upsertWikiPage({ id, slug, title, content, pageType });

    if (context.reviewId) {
      addWikiPageSource(id, context.reviewId);
    }

    const verb = existing ? "Updated" : "Created";
    return `${verb} knowledge base page: **${title}** ([[${slug}]])\n\nType: ${pageType} | Slug: ${slug}`;
  },
};
