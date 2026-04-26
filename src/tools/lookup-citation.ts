/**
 * Tool: lookup_citation
 *
 * Resolves a reference key (e.g. "[27]" or "Vaswani2017") against the
 * parsed paper's reference list. When the reference has an arXiv ID or
 * DOI, optionally fetches the abstract from Semantic Scholar so the
 * agent can answer follow-up questions about the cited work.
 */

import type { ToolDefinition } from "./types";

export const lookupCitationTool: ToolDefinition = {
  name: "lookup_citation",
  description:
    "Look up a bibliographic reference from the paper's reference list. " +
    'Provide the citation key as it appears in the paper (e.g. "[27]", ' +
    '"Vaswani et al. 2017", "Vaswani2017"). Returns the full reference ' +
    "text and, when available, the abstract of the cited paper. Use when " +
    "the user asks about a specific citation or when verifying what a " +
    "claim is grounded in.",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description:
          "The citation key as it appears in the paper. " +
          'Match is fuzzy (case-insensitive substring), so "[27]", "27", and ' +
          '"Vaswani" are all reasonable inputs.',
      },
    },
    required: ["key"],
  },

  async execute(input, context) {
    const parsed = context.parsedPaper;
    if (!parsed) {
      return (
        "Error: this paper hasn't been parsed into structured form yet. " +
        "References aren't available."
      );
    }

    if (parsed.references.length === 0) {
      return "Error: parsed paper has no references.";
    }

    const keyRaw = String(input.key ?? "").trim();
    if (!keyRaw) return "Error: key is required.";

    const needle = normalizeKey(keyRaw);
    let match = parsed.references.find(
      (r) => normalizeKey(r.key) === needle,
    );
    if (!match) {
      match = parsed.references.find((r) =>
        normalizeKey(r.key).includes(needle),
      );
    }
    if (!match) {
      // Last resort: search reference text by author surname.
      match = parsed.references.find((r) =>
        r.text.toLowerCase().includes(keyRaw.toLowerCase()),
      );
    }

    if (!match) {
      return `No reference matches "${keyRaw}". The paper has ${parsed.references.length} references.`;
    }

    const lines: string[] = [];
    lines.push(`Reference: ${match.key}`);
    lines.push(match.text);
    if (match.doi) lines.push(`DOI: ${match.doi}`);
    if (match.arxivId) lines.push(`arXiv: ${match.arxivId}`);

    // If we have an arXiv ID, fetch the abstract so the agent can answer
    // follow-up questions without a separate arxiv_search call.
    if (match.arxivId) {
      const abstract = await fetchArxivAbstract(match.arxivId);
      if (abstract) {
        lines.push("");
        lines.push(`Abstract:\n${abstract}`);
      }
    }

    return lines.join("\n");
  },
};

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchArxivAbstract(arxivId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/arXiv:${arxivId}?fields=abstract`,
      { headers: { "User-Agent": "Artifact/1.0 (paper reading tool)" } },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { abstract?: string | null };
    return data.abstract ?? null;
  } catch {
    return null;
  }
}
