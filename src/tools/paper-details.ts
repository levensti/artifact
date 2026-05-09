/**
 * Tool: paper_details
 *
 * Fetches richer metadata for a single paper than `arxiv_search` returns
 * — full abstract (untruncated), Semantic Scholar's generated TLDR, full
 * author list, year/venue/citations/references. Used by the discovery
 * agent's Verify stage: title-pattern matching is unreliable, so before
 * committing to a curated pick the agent calls this to confirm the paper
 * actually addresses the user's interest.
 */

import type { ToolDefinition } from "./types";

interface S2PaperDetail {
  paperId: string;
  title: string | null;
  abstract: string | null;
  tldr?: { text: string } | null;
  authors: Array<{ name: string }>;
  year: number | null;
  venue: string | null;
  citationCount: number | null;
  referenceCount: number | null;
  externalIds: Record<string, string> | null;
  url: string;
}

const FIELDS = [
  "title",
  "abstract",
  "tldr",
  "authors",
  "year",
  "venue",
  "citationCount",
  "referenceCount",
  "externalIds",
  "url",
].join(",");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchS2(paperId: string): Promise<S2PaperDetail | null> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}?fields=${FIELDS}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);
    const response = await fetch(url, {
      headers: { "User-Agent": "Artifact/1.0 (academic research tool)" },
    });
    if (response.status === 404) return null;
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const wait = Math.min(Number(retryAfter) * 1000 || 5000, 15000);
      if (attempt < 2) {
        await sleep(wait);
        continue;
      }
    }
    if (!response.ok) {
      throw new Error(`Semantic Scholar returned ${response.status}`);
    }
    return (await response.json()) as S2PaperDetail;
  }
  throw new Error("Max retries exceeded");
}

export const paperDetailsTool: ToolDefinition = {
  name: "paper_details",
  description:
    "Fetch the full abstract, TLDR (one-sentence Semantic Scholar summary), full author list, year, venue, citation count, and reference count for a paper given its arXiv id. Use this in the Verify stage of discovery to confirm a candidate actually addresses the user's interest before recommending it — title alone is often misleading. Issue multiple calls in parallel to verify several candidates at once.",
  parameters: {
    type: "object",
    properties: {
      arxivId: {
        type: "string",
        description:
          "arXiv id like '2401.12345' OR a full arXiv URL ('https://arxiv.org/abs/2401.12345' is fine). Trailing version suffixes (v1, v2) are stripped automatically.",
      },
    },
    required: ["arxivId"],
  },

  async execute(input: Record<string, unknown>) {
    const raw = String(input.arxivId ?? "").trim();
    if (!raw) return "Error: arxivId parameter is required.";
    // Accept either bare ids or full URLs — the agent often copies the URL
    // straight from search results, no reason to make it strip the prefix.
    const idFromUrl = raw.match(/arxiv\.org\/abs\/([^/?#\s]+)/i)?.[1];
    const arxivId = (idFromUrl ?? raw).replace(/v\d+$/i, "");

    try {
      const detail = await fetchS2(`ARXIV:${arxivId}`);
      if (!detail)
        return `No details found for arXiv:${arxivId}. The paper may not be indexed by Semantic Scholar.`;

      const lines: string[] = [];
      if (detail.title) lines.push(`Title: ${detail.title}`);
      const meta: string[] = [];
      if (detail.year) meta.push(String(detail.year));
      if (detail.venue) meta.push(detail.venue);
      if (detail.citationCount != null)
        meta.push(`${detail.citationCount} citations`);
      if (detail.referenceCount != null)
        meta.push(`${detail.referenceCount} references`);
      if (meta.length > 0) lines.push(`Meta: ${meta.join(" · ")}`);
      if (detail.authors.length > 0) {
        lines.push(
          `Authors: ${detail.authors.map((a) => a.name).join(", ")}`,
        );
      }
      if (detail.tldr?.text) lines.push(`TLDR: ${detail.tldr.text}`);
      if (detail.abstract) lines.push(`Abstract: ${detail.abstract}`);
      lines.push(`URL: https://arxiv.org/abs/${arxivId}`);
      return lines.join("\n\n");
    } catch (err) {
      return `Failed to fetch paper details for arXiv:${arxivId}: ${err instanceof Error ? err.message : "unknown error"}.`;
    }
  },
};
