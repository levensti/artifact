/**
 * Tool: rank_results
 *
 * Takes a list of items (search results, papers, concepts) and ranks them
 * by relevance to a given criterion. This is a "meta-tool" — the LLM uses
 * it to filter and prioritize results from other tools before presenting
 * them to the user.
 *
 * Unlike other tools, this one doesn't call an external API. It formats
 * the ranking request so the LLM can reason about relevance in a focused way.
 */

import type { ToolDefinition } from "./types";

export const rankResultsTool: ToolDefinition = {
  name: "rank_results",
  description:
    "Rank and filter a list of items (papers, search results, concepts) by relevance to " +
    "a specific criterion. Use this after searching to identify the most relevant results. " +
    "Returns the items re-ordered with relevance scores and reasoning. " +
    "You provide the items as a JSON array of objects and the criterion to rank by.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "string",
        description:
          "JSON string of the items to rank. Each item should be an object with at least " +
          'a "title" or "name" field and a "description" or "abstract" field. ' +
          'Example: [{"title":"Paper A","abstract":"..."},{"title":"Paper B","abstract":"..."}]',
      },
      criterion: {
        type: "string",
        description:
          "What to rank by — the question, topic, or goal that determines relevance. " +
          'Example: "papers that introduce the core techniques used in diffusion models"',
      },
      top_k: {
        type: "number",
        description: "Return only the top K most relevant items. Default: 5.",
        default: 5,
      },
    },
    required: ["items", "criterion"],
  },

  async execute(input: Record<string, unknown>) {
    const criterion = String(input.criterion ?? "").trim();
    if (!criterion) return "Error: criterion parameter is required.";

    let items: Array<Record<string, unknown>>;
    try {
      const raw = String(input.items ?? "[]");
      items = JSON.parse(raw);
      if (!Array.isArray(items)) throw new Error("not an array");
    } catch {
      return "Error: items must be a valid JSON array of objects.";
    }

    if (items.length === 0) return "No items to rank.";

    const topK = Math.max(1, Math.min(items.length, Number(input.top_k) || 5));

    // Format the items for the LLM to reason about in its next turn.
    // The LLM will see this tool result and can use it to compose a ranked response.
    const numbered = items.map((item, i) => {
      const title = String(item.title ?? item.name ?? `Item ${i + 1}`);
      const desc = String(item.description ?? item.abstract ?? "");
      const snippet = desc.length > 200 ? desc.slice(0, 197) + "..." : desc;
      return `[${i + 1}] ${title}\n    ${snippet}`;
    });

    return [
      `Ranking ${items.length} items by: "${criterion}"`,
      `Return the top ${topK} most relevant.\n`,
      `Items:\n${numbered.join("\n\n")}`,
      `\nInstructions: In your response, present only the top ${topK} items ` +
      `re-ordered by relevance to the criterion. For each, explain briefly ` +
      `why it is relevant.`,
    ].join("\n");
  },
};
