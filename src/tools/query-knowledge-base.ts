/**
 * Tool: query_knowledge_base
 *
 * Searches the user's Knowledge Base wiki pages.
 * The LLM uses this to check what the user already knows about a topic
 * before explaining it, and to find existing pages before creating duplicates.
 */

import type { ToolDefinition } from "./types";
import { searchWikiPages, listWikiPages } from "@/lib/server/store";

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

/** Strip YAML frontmatter from markdown content. */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("---", 3);
  if (end === -1) return content;
  return content.slice(end + 3).trim();
}

export const queryKnowledgeBaseTool: ToolDefinition = {
  name: "query_knowledge_base",
  description:
    "Search the user's Knowledge Base for existing wiki pages about concepts, methods, results, and paper summaries. " +
    "Use this to check what the user already knows about a topic before explaining it from scratch, " +
    "and to find existing pages before creating duplicates with update_knowledge_base.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query to find relevant KB pages.",
      },
      page_type: {
        type: "string",
        description:
          'Optional filter by page type: "concept", "method", "result", "paper-summary", "topic".',
        enum: ["concept", "method", "result", "paper-summary", "topic"],
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (default: 5).",
      },
    },
    required: ["query"],
  },

  async execute(input: Record<string, unknown>): Promise<string> {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    const pageType = typeof input.page_type === "string" ? input.page_type : undefined;
    const maxResults = typeof input.max_results === "number" ? Math.min(20, Math.max(1, input.max_results)) : 5;

    if (!query) {
      return "Error: query is required.";
    }

    let results = searchWikiPages(query, maxResults * 2);

    if (pageType) {
      results = results.filter((p) => p.pageType === pageType);
    }
    results = results.slice(0, maxResults);

    if (results.length === 0) {
      // Check total pages to give helpful context
      const total = listWikiPages().length;
      if (total === 0) {
        return "The Knowledge Base is empty — no pages have been created yet.";
      }
      return `No KB pages found matching "${query}" (${total} total pages in the Knowledge Base).`;
    }

    const formatted = results.map((p) => {
      const body = stripFrontmatter(p.content);
      return [
        `### ${p.title}`,
        `**Type:** ${p.pageType} | **Slug:** ${p.slug}`,
        `**Tags:** ${p.tags.length > 0 ? p.tags.join(", ") : "none"}`,
        `**Last updated:** ${p.updatedAt}`,
        "",
        truncate(body, 400),
      ].join("\n");
    });

    return `Found ${results.length} KB page${results.length !== 1 ? "s" : ""}:\n\n${formatted.join("\n\n---\n\n")}`;
  },
};
