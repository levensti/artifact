/**
 * Tool: query_knowledge_base
 *
 * Searches the persistent knowledge base wiki for existing pages.
 * Returns page excerpts so the assistant can reference accumulated knowledge
 * instead of re-deriving answers from scratch.
 */

import type { ToolDefinition, ToolContext } from "./types";
import { searchWikiPages, getWikiPageBySlug } from "@/lib/server/store";

export const queryWikiTool: ToolDefinition = {
  name: "query_knowledge_base",
  description:
    "Search the persistent knowledge base for existing wiki pages about concepts, methods, papers, or entities. " +
    "Use this BEFORE explaining concepts to check if the knowledge base already has relevant content. " +
    "You can search by keyword (returns matching pages) or read a specific page by its slug.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query to find relevant knowledge base pages. Returns pages with matching titles or content.",
      },
      slug: {
        type: "string",
        description:
          "Read a specific page by its slug (e.g. 'attention-mechanism'). Returns the full page content.",
      },
    },
  },

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const slug = typeof input.slug === "string" ? input.slug.trim() : "";
    const query = typeof input.query === "string" ? input.query.trim() : "";

    if (slug) {
      const page = getWikiPageBySlug(slug);
      if (!page) {
        return `No knowledge base page found with slug "${slug}".`;
      }
      return `# ${page.title}\n\n**Type:** ${page.pageType} | **Updated:** ${page.updatedAt}\n\n${page.content}`;
    }

    if (query) {
      const results = searchWikiPages(query);
      if (results.length === 0) {
        return `No knowledge base pages found matching "${query}". Consider creating pages with update_knowledge_base if you explain this topic.`;
      }

      const formatted = results.slice(0, 5).map((p) => {
        const excerpt = p.content
          .replace(/^#.*\n/gm, "")
          .replace(/\n+/g, " ")
          .trim()
          .slice(0, 300);
        return `- **[[${p.slug}]]** (${p.pageType}) \u2014 ${p.title}\n  ${excerpt}${excerpt.length >= 300 ? "\u2026" : ""}`;
      });

      return `Found ${results.length} knowledge base page${results.length !== 1 ? "s" : ""} matching "${query}":\n\n${formatted.join("\n\n")}\n\nUse slug parameter to read a full page.`;
    }

    return "Error: provide either a query (to search) or a slug (to read a specific page).";
  },
};
