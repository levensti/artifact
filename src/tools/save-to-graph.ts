/**
 * Tool: save_to_knowledge_graph
 *
 * Server-side this tool only validates the inputs the LLM provides; the
 * actual persistence happens client-side in use-chat.ts once the stream
 * completes (the graph lives in IndexedDB on the user's device).
 */

import type { ToolDefinition } from "./types";
import type { RelationshipType } from "@/lib/explore";

const VALID_RELATIONSHIPS = new Set<RelationshipType>([
  "builds-upon",
  "extends",
  "similar-approach",
  "prerequisite",
  "contrasts-with",
]);

export const saveToGraphTool: ToolDefinition = {
  name: "save_to_knowledge_graph",
  description:
    "Save related papers you've found to the knowledge graph so the user can visualize and revisit them later in the Discovery tab. " +
    "Use this after finding relevant papers via arxiv_search — it persists the relationships (prerequisite, builds-upon, extends, similar-approach, contrasts-with) " +
    "between the current paper and the related papers you discovered.",
  parameters: {
    type: "object",
    properties: {
      papers: {
        type: "array",
        description:
          'Array of related papers to save. Each must have: arxiv_id (string), title (string), relationship (one of: "prerequisite", "builds-upon", "extends", "similar-approach", "contrasts-with"), reasoning (one sentence explaining the relationship). Optional: authors (string[]), abstract (string).',
        items: { type: "object" },
      },
    },
    required: ["papers"],
  },

  async execute(input: Record<string, unknown>): Promise<string> {
    const rawPapers = input.papers;
    if (!Array.isArray(rawPapers) || rawPapers.length === 0) {
      return "Error: papers array is required and must not be empty.";
    }

    let valid = 0;
    for (const p of rawPapers) {
      if (!p || typeof p !== "object") continue;
      const obj = p as Record<string, unknown>;
      const id = String(obj.arxiv_id ?? obj.arxivId ?? "").trim();
      const title = String(obj.title ?? "").trim();
      const relationship = String(obj.relationship ?? "").trim() as RelationshipType;
      if (!id || !title) continue;
      if (!VALID_RELATIONSHIPS.has(relationship)) continue;
      valid++;
    }

    if (valid === 0) {
      return "Error: no valid papers. Each needs arxiv_id, title, a valid relationship type, and reasoning.";
    }
    return `Queued ${valid} paper${valid !== 1 ? "s" : ""} for the knowledge graph. The user will see them in the Discovery tab once this turn completes.\n\n[Open Discover](/discovery)`;
  },
};
