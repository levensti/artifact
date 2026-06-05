/**
 * Tool: web_search
 *
 * General web search for grounding technical answers with real-world sources.
 * Uses the Exa Search API (neural + keyword auto-routing).
 *
 * The user supplies the Exa API key via Settings (stored in IndexedDB and
 * sent inline with each chat request). Server-side `EXA_API_KEY` env variable
 * is also honored as a fallback for self-hosted deployments.
 *
 * When neither key source is available, the tool returns the
 * EXA_KEY_REQUIRED_SENTINEL string. The chat UI detects this in the
 * tool_result event and surfaces an inline "Add Exa API key" card (with a
 * dismiss option) — the agent itself is instructed not to verbalize the
 * failure.
 *
 * Get a key at: https://dashboard.exa.ai/
 */

import type { ToolDefinition } from "./types";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

/**
 * Sentinel returned by web_search when no Exa key is configured. Both the
 * server tool and the client UI import this constant so the contract stays
 * in one place.
 */
export const EXA_KEY_REQUIRED_SENTINEL = "EXA_KEY_REQUIRED";

interface ExaResult {
  title?: string | null;
  url: string;
  text?: string | null;
}

interface ExaSearchResponse {
  results?: ExaResult[];
}

async function exaSearch(
  query: string,
  count: number,
  apiKey: string,
): Promise<{ title: string; url: string; description: string }[]> {
  const response = await fetchWithTimeout("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: count,
      type: "auto",
      contents: { text: { maxCharacters: 500 } },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Exa Search API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data: ExaSearchResponse = await response.json();
  const results = data.results ?? [];
  return results.map((r) => ({
    title: (r.title ?? r.url).trim(),
    url: r.url,
    description: (r.text ?? "").replace(/\s+/g, " ").trim(),
  }));
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
          "A natural-language description of what you're looking for. Phrase it like " +
          "you're describing the ideal page to a librarian, not typing keywords. " +
          'Example: "a clear tutorial explaining the reparameterization trick in ' +
          'variational inference, written for someone who already knows basic Bayesian inference".',
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
    if (!query) return { content: "Error: query parameter is required.", ok: false };

    const count = Math.max(1, Math.min(10, Number(input.count) || 5));
    const apiKey =
      context.exaApiKey?.trim() ||
      process.env.EXA_API_KEY ||
      "";
    if (!apiKey) {
      // No key: raise a control signal so the loop can pause for the user. The
      // chat UI watches for this exact `content` string and renders an inline
      // "Configure Exa Search" card; the agent is told (in the system prompt)
      // not to verbalize the failure.
      return {
        content: EXA_KEY_REQUIRED_SENTINEL,
        ok: false,
        control: "needs_user_input",
      };
    }

    try {
      const results = await exaSearch(query, count, apiKey);

      if (results.length === 0) {
        return {
          content: `No web results found for: "${query}". Try rephrasing the search.`,
          ok: false,
        };
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
      return {
        content: `Web search failed: ${err instanceof Error ? err.message : "unknown error"}`,
        ok: false,
      };
    }
  },
};
