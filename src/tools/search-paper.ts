/**
 * Tool: search_paper
 *
 * Vector search over the document's semantic chunks, with section and page
 * provenance. Registered whenever the turn has an indexed document, which
 * is every document chat can read.
 */

import { formatPages } from "@/lib/documents";
import type { ToolDefinition } from "./types";

export const searchPaperTool: ToolDefinition = {
  name: "search_paper",
  description:
    "Search the paper for passages matching a query. Returns the top-k " +
    "matching passages with their section heading and page. Use when you " +
    'need to find where a concept is discussed (e.g. "where does the paper ' +
    'introduce the loss function?") rather than reading a known section.',
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Natural-language query or keywords describing the passage you want. " +
          'Example: "ablation results on ImageNet".',
      },
      k: {
        type: "number",
        description: "Number of top passages to return (1-10). Default: 5.",
        default: 5,
      },
    },
    required: ["query"],
  },

  async execute(input, context) {
    const query = String(input.query ?? "").trim();
    if (!query) return { content: "Error: query is required.", ok: false };
    const k = Math.max(1, Math.min(10, Number(input.k) || 5));

    if (context.searchChunks) {
      const hits = await context.searchChunks(query, k);
      if (hits.length === 0) {
        return { content: `No passages match "${query}".`, ok: false };
      }
      const blocks = hits.map((h) => {
        const section = h.sectionLabel
          ? `§${h.sectionLabel} ${h.sectionTitle ?? ""}`.trim()
          : h.sectionTitle ?? "(unsectioned)";
        const pages = formatPages(h.startPage, h.endPage);
        return `${section}${pages ? ` (${pages})` : ""}\n${h.text}`;
      });
      return `Top ${hits.length} passages for "${query}":\n\n${blocks.join("\n\n")}`;
    }

    return {
      content:
        "Error: this document has no search index (it is short enough to be " +
        "fully in context; read it directly).",
      ok: false,
    };
  },
};
