/**
 * Tool: submit_picks
 *
 * The structured-output mechanism for the discovery agent. Instead of
 * extracting recommendations by regex-parsing the agent's Markdown, the
 * agent calls this tool exactly once at the end of its workflow with a
 * JSON array of picks. The discover finalize endpoint reads the picks
 * directly from the tool_call event — no parser, no contract drift.
 *
 * The tool's `execute` is purely an acknowledgement; the actual write to
 * the Recommendation table happens client-side after the stream
 * completes (the client extracts the structured args from the tool_call
 * step and POSTs them to /api/discover-queries/[id]).
 */

import type { ToolDefinition } from "./types";

export const submitPicksTool: ToolDefinition = {
  name: "submit_picks",
  description:
    "Submit your final curated list of recommendations — arXiv papers, web sources (lab blog posts, technical writeups, surveys), or a mix. Call this exactly ONCE at the end of your discovery turn after planning, searching, verifying, and filtering. The picks you submit here are what appear in the user's reading queue — the source of truth. Do not also emit the picks as a Markdown list.",
  parameters: {
    type: "object",
    properties: {
      picks: {
        type: "array",
        description:
          "Five to seven picks, each with the canonical URL, title, and a one-sentence rationale grounded in evidence (verified TLDR/abstract for arXiv picks, the search-result description for web picks).",
        items: {
          type: "object",
          description: "A single recommendation — arXiv paper or web source.",
          properties: {
            url: {
              type: "string",
              description:
                "Canonical URL: `https://arxiv.org/abs/ID` for arXiv papers, the source URL for web picks (blog posts, writeups, surveys).",
            },
            title: {
              type: "string",
              description: "Paper title or web page title.",
            },
            rationale: {
              type: "string",
              description:
                "One sentence on why this fits the user's interest. Reference the actual contribution — what the paper or post does and why that matters for the query — not a paraphrase of the title.",
            },
            arxivId: {
              type: "string",
              description:
                "arXiv id like '2401.12345' for arXiv papers ONLY. Omit entirely for web picks.",
            },
            authors: {
              type: "string",
              description:
                "Optional comma-separated paper authors when known from search or verification.",
            },
            publishedDate: {
              type: "string",
              description:
                "Optional exact publication/release date as YYYY-MM-DD when known.",
            },
            publishedYear: {
              type: "number",
              description:
                "Optional publication/release year when known from search or verification.",
            },
            venue: {
              type: "string",
              description:
                "Optional publication venue or conference name when known.",
            },
            citationCount: {
              type: "number",
              description:
                "Optional citation count when known from search or verification.",
            },
          },
          required: ["url", "title", "rationale"],
        },
      },
    },
    required: ["picks"],
  },

  async execute(input: Record<string, unknown>) {
    const picks = Array.isArray(input.picks) ? input.picks : [];
    return `Acknowledged ${picks.length} pick${picks.length === 1 ? "" : "s"}. They will appear in the user's reading queue. End your turn with a brief confirmation — do NOT repeat the picks.`;
  },
};
