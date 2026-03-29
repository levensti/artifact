/**
 * Tool: arxiv_search
 *
 * Searches for academic papers using the Semantic Scholar API (primary)
 * with arXiv API as fallback. Semantic Scholar is faster, more reliable,
 * and doesn't aggressively rate-limit like arXiv's export endpoint.
 */

import type { ToolDefinition } from "./types";

interface PaperResult {
  title: string;
  abstract: string;
  authors: string[];
  year: number | null;
  arxivId: string | null;
  paperId: string;
  venue: string | null;
  citationCount: number | null;
  url: string;
}

/* ------------------------------------------------------------------ */
/*  Semantic Scholar (primary)                                         */
/* ------------------------------------------------------------------ */

interface S2Paper {
  paperId: string;
  title: string;
  abstract: string | null;
  authors: Array<{ name: string }>;
  year: number | null;
  venue: string | null;
  citationCount: number | null;
  externalIds: Record<string, string> | null;
  url: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);

    const response = await fetch(url, {
      headers: { "User-Agent": "PaperCopilot/1.0 (academic research tool)" },
    });

    if (response.status === 429) {
      // Check for Retry-After header
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter && attempt < maxRetries - 1) {
        await sleep(Math.min(Number(retryAfter) * 1000 || 5000, 15000));
        continue;
      }
      if (attempt < maxRetries - 1) continue;
    }

    return response;
  }

  throw new Error("Max retries exceeded");
}

async function searchSemanticScholar(query: string, limit: number): Promise<PaperResult[]> {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
    fields: "title,abstract,authors,year,venue,citationCount,externalIds,url",
  });

  const response = await fetchWithRetry(
    `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
  );

  if (!response.ok) {
    throw new Error(`Semantic Scholar API returned ${response.status}`);
  }

  const data: { data?: S2Paper[] } = await response.json();
  if (!data.data) return [];

  return data.data
    .filter((p) => p.title)
    .map((p) => ({
      title: p.title,
      abstract: p.abstract ?? "",
      authors: p.authors.map((a) => a.name),
      year: p.year,
      arxivId: p.externalIds?.ArXiv ?? null,
      paperId: p.paperId,
      venue: p.venue || null,
      citationCount: p.citationCount,
      url: p.externalIds?.ArXiv
        ? `https://arxiv.org/abs/${p.externalIds.ArXiv}`
        : p.url,
    }));
}

/* ------------------------------------------------------------------ */
/*  arXiv fallback                                                     */
/* ------------------------------------------------------------------ */

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1]?.trim() ?? null;
}

function extractAll(xml: string, regex: RegExp): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null = regex.exec(xml);
  while (match) {
    out.push(match[1].trim());
    match = regex.exec(xml);
  }
  return out;
}

async function searchArxivFallback(query: string, maxResults: number): Promise<PaperResult[]> {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

  const response = await fetchWithRetry(url);

  if (!response.ok) {
    throw new Error(`arXiv API returned ${response.status}`);
  }

  const xml = await response.text();
  return xml
    .split("<entry>")
    .slice(1)
    .map((part) => {
      const entry = `<entry>${part}`;
      const idRaw = extractTag(entry, "id") ?? "";
      const arxivId = (idRaw.match(/\/abs\/([^v<\s]+)/)?.[1] ?? "").trim();
      return {
        title: (extractTag(entry, "title") ?? "").replace(/\s+/g, " ").trim(),
        abstract: (extractTag(entry, "summary") ?? "").replace(/\s+/g, " ").trim(),
        authors: extractAll(entry, /<name>([\s\S]*?)<\/name>/g),
        year: null,
        arxivId: arxivId || null,
        paperId: arxivId,
        venue: null,
        citationCount: null,
        url: arxivId ? `https://arxiv.org/abs/${arxivId}` : "",
      };
    })
    .filter((e) => e.title);
}

/* ------------------------------------------------------------------ */
/*  Tool definition                                                    */
/* ------------------------------------------------------------------ */

export const arxivSearchTool: ToolDefinition = {
  name: "arxiv_search",
  description:
    "Search for academic papers by topic, method, author, or any keywords. " +
    "Returns titles, abstracts, authors, citation counts, and links. " +
    "Use this to find related work, prerequisite papers, seminal references, " +
    "or papers on specific topics.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query — use natural language keywords or phrases. " +
          'Example: "attention mechanism transformers" or "variational autoencoders image generation"',
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (1-20). Default: 8.",
        default: 8,
      },
    },
    required: ["query"],
  },

  async execute(input) {
    const query = String(input.query ?? "").trim();
    if (!query) return "Error: query parameter is required.";

    const maxResults = Math.max(1, Math.min(20, Number(input.max_results) || 8));

    let results: PaperResult[];
    let source: string;

    // Try Semantic Scholar first, fall back to arXiv
    try {
      results = await searchSemanticScholar(query, maxResults);
      source = "Semantic Scholar";
    } catch {
      try {
        results = await searchArxivFallback(query, maxResults);
        source = "arXiv";
      } catch (err) {
        return `Paper search failed: ${err instanceof Error ? err.message : "unknown error"}. Both Semantic Scholar and arXiv are unavailable.`;
      }
    }

    if (results.length === 0) {
      return `No papers found for: "${query}". Try broadening or rephrasing the search.`;
    }

    const formatted = results.map((r, i) => {
      const authors =
        r.authors.slice(0, 4).join(", ") +
        (r.authors.length > 4 ? " et al." : "");
      const meta = [
        r.year ? String(r.year) : null,
        r.venue ? r.venue : null,
        r.citationCount != null ? `${r.citationCount} citations` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const abstractSnippet =
        r.abstract.length > 300 ? r.abstract.slice(0, 297) + "..." : r.abstract;

      return [
        `[${i + 1}] ${r.title}`,
        `    ${r.url}${meta ? ` | ${meta}` : ""}`,
        `    Authors: ${authors}`,
        abstractSnippet ? `    ${abstractSnippet}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    });

    return `Found ${results.length} papers for "${query}" (via ${source}):\n\n${formatted.join("\n\n")}`;
  },
};
