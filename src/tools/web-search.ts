/**
 * Tool: web_search
 *
 * General web search for grounding technical answers with real-world sources.
 * Uses the Brave Search API.
 *
 * The user supplies the Brave API key via Settings (stored in IndexedDB and
 * sent inline with each chat request). Server-side `BRAVE_SEARCH_API_KEY`
 * env variable is also honored as a fallback for self-hosted deployments.
 *
 * When neither key source is available, the tool returns the
 * BRAVE_KEY_REQUIRED_SENTINEL string. The chat UI detects this in the
 * tool_result event and surfaces an inline "Add Brave Search API key" card
 * (with a dismiss option) — the agent itself is instructed not to verbalize
 * the failure.
 *
 * Get a free key at: https://brave.com/search/api/
 */

import type { ToolDefinition } from "./types";

/**
 * Sentinel returned by web_search when no Brave key is configured. Both the
 * server tool and the client UI import this constant so the contract stays
 * in one place.
 */
export const BRAVE_KEY_REQUIRED_SENTINEL = "BRAVE_KEY_REQUIRED";

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

async function braveSearch(
  query: string,
  count: number,
  apiKey: string,
): Promise<BraveWebResult[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    text_decorations: "false",
    search_lang: "en",
  });

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Brave Search API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data: BraveSearchResponse = await response.json();
  return data.web?.results ?? [];
}

export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description:
    "Search the web for current information, documentation, blog posts, tutorials, or any " +
    "content that can help ground your answers. Useful for: looking up specific algorithms, " +
    "checking implementation details, finding official documentation, verifying claims, " +
    "finding explanations of niche concepts, or getting the latest information on a topic.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Web search query. Be specific and technical for best results. " +
          'Example: "variational inference reparameterization trick tutorial"',
      },
      count: {
        type: "number",
        description: "Number of results to return (1-10). Default: 5.",
        default: 5,
      },
    },
    required: ["query"],
  },

  async execute(input: Record<string, unknown>, context) {
    const query = String(input.query ?? "").trim();
    if (!query) return "Error: query parameter is required.";

    const count = Math.max(1, Math.min(10, Number(input.count) || 5));
    const apiKey =
      context.braveSearchApiKey?.trim() ||
      process.env.BRAVE_SEARCH_API_KEY ||
      "";
    if (!apiKey) {
      // The chat UI watches for this exact string and renders an inline
      // "Configure Brave Search" card in place of the tool result. The
      // agent is told (in the system prompt) not to verbalize the failure.
      return BRAVE_KEY_REQUIRED_SENTINEL;
    }

    try {
      const results = await braveSearch(query, count, apiKey);

      if (results.length === 0) {
        return `No web results found for: "${query}". Try rephrasing the search.`;
      }

      const formatted = results.map((r, i) =>
        [
          `[${i + 1}] ${r.title}`,
          `    URL: ${r.url}`,
          `    ${r.description}`,
        ].join("\n"),
      );

      return `Found ${results.length} web results for "${query}":\n\n${formatted.join("\n\n")}`;
    } catch (err) {
      return `Web search failed: ${err instanceof Error ? err.message : "unknown error"}`;
    }
  },
};
