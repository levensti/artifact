/**
 * Tool: update_knowledge_base
 *
 * Creates or updates wiki pages in the Knowledge Base during chat.
 * The LLM uses this to persist concepts, methods, results, and
 * paper summaries it encounters or explains during conversation.
 */

import type { ToolDefinition, ToolContext } from "./types";
import type { WikiPage, WikiPageType } from "@/lib/kb-types";
import {
  getWikiPageBySlug,
  upsertWikiPage,
  addWikiPageSource,
  insertKbLog,
} from "@/lib/server/store";

const VALID_PAGE_TYPES = new Set<WikiPageType>([
  "concept",
  "method",
  "result",
  "paper-summary",
  "topic",
]);

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

export const updateKnowledgeBaseTool: ToolDefinition = {
  name: "update_knowledge_base",
  description:
    "Create or update a wiki page in the user's Knowledge Base. Use this to save important concepts, methods, results, or paper summaries " +
    "so the user can build a persistent personal wiki of compiled knowledge across all papers they read. " +
    "When a page with the given slug already exists, the new content is appended as a new section. " +
    "Use [[slug]] syntax in content for cross-references to other KB pages.",
  parameters: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description:
          'URL-friendly page identifier (lowercase, hyphens). E.g. "attention-mechanism", "transformer-architecture".',
      },
      title: {
        type: "string",
        description: "Human-readable page title.",
      },
      page_type: {
        type: "string",
        description:
          'Type of knowledge page: "concept", "method", "result", "paper-summary", or "topic".',
        enum: ["concept", "method", "result", "paper-summary", "topic"],
      },
      content: {
        type: "string",
        description:
          "Markdown content for the page. Use [[slug]] for cross-references. Write in evergreen third-person style.",
      },
      tags: {
        type: "array",
        description: "Optional classification tags.",
        items: { type: "string" },
      },
    },
    required: ["slug", "title", "page_type", "content"],
  },

  async execute(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const rawSlug = typeof input.slug === "string" ? toSlug(input.slug) : "";
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const pageType = typeof input.page_type === "string"
      ? (input.page_type as WikiPageType)
      : "concept";
    const content = typeof input.content === "string" ? input.content.trim() : "";
    const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];

    if (!rawSlug || !title) {
      return "Error: slug and title are required.";
    }
    if (!VALID_PAGE_TYPES.has(pageType)) {
      return `Error: invalid page_type "${pageType}". Use one of: concept, method, result, paper-summary, topic.`;
    }
    if (!content) {
      return "Error: content is required.";
    }

    const existing = getWikiPageBySlug(rawSlug);
    const now = new Date().toISOString();

    if (existing) {
      // Append new content as a section
      const sourceLabel = context.paperTitle
        ? `\n\n---\n*Updated from: ${context.paperTitle}*\n`
        : "";
      const merged = `${existing.content}\n\n${content}${sourceLabel}`;
      const updated: WikiPage = {
        ...existing,
        content: merged,
        tags: [...new Set([...existing.tags, ...tags])],
        updatedAt: now,
      };
      upsertWikiPage(updated);

      if (context.reviewId) {
        addWikiPageSource(existing.id, context.reviewId);
      }

      insertKbLog({
        id: crypto.randomUUID(),
        action: "update",
        description: `Updated "${title}" with new content${context.paperTitle ? ` from "${context.paperTitle}"` : ""}.`,
        affectedPageIds: [existing.id],
        reviewId: context.reviewId,
        createdAt: now,
      });

      return `Updated KB page: **${title}** (/kb/${rawSlug}). New content appended to existing page.\n\n[View in Knowledge Base](/kb/${rawSlug})`;
    }

    // Create new page
    const id = crypto.randomUUID();
    const page: WikiPage = {
      id,
      slug: rawSlug,
      title,
      content,
      pageType,
      tags,
      createdAt: now,
      updatedAt: now,
    };
    upsertWikiPage(page);

    if (context.reviewId) {
      addWikiPageSource(id, context.reviewId);
    }

    insertKbLog({
      id: crypto.randomUUID(),
      action: "create",
      description: `Created "${title}" (${pageType})${context.paperTitle ? ` from "${context.paperTitle}"` : ""}.`,
      affectedPageIds: [id],
      reviewId: context.reviewId,
      createdAt: now,
    });

    return `Created KB page: **${title}** (/kb/${rawSlug}).\n\n[View in Knowledge Base](/kb/${rawSlug})`;
  },
};
