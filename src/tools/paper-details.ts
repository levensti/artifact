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
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { SEMANTIC_SCHOLAR_BASE, semanticScholarHeaders } from "@/lib/semantic-scholar";

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

interface ArxivDetail {
  title: string;
  abstract: string;
  authors: string[];
  published: string | null;
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
  const url = `${SEMANTIC_SCHOLAR_BASE}/paper/${encodeURIComponent(paperId)}?fields=${FIELDS}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);
    const response = await fetchWithTimeout(url, {
      headers: semanticScholarHeaders(),
    });
    if (response.status === 404) return null;
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const wait = Math.min(Number(retryAfter) * 1000 || 5000, 8000);
      // Only back off if there's another attempt left — no point sleeping
      // before throwing.
      if (attempt < 1) {
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

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

function extractAll(xml: string, regex: RegExp): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null = regex.exec(xml);
  while (match) {
    out.push(match[1].replace(/\s+/g, " ").trim());
    match = regex.exec(xml);
  }
  return out;
}

async function fetchArxiv(arxivId: string): Promise<ArxivDetail | null> {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  const response = await fetchWithTimeout(url, {
    headers: { "User-Agent": "Artifact/1.0 (academic research tool)" },
  });
  if (!response.ok) throw new Error(`arXiv returned ${response.status}`);
  const xml = await response.text();
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[0];
  if (!entry) return null;
  const title = extractTag(entry, "title");
  const abstract = extractTag(entry, "summary");
  if (!title || !abstract) return null;
  return {
    title,
    abstract,
    authors: extractAll(entry, /<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g),
    published: extractTag(entry, "published"),
    url: `https://arxiv.org/abs/${arxivId}`,
  };
}

function formatArxivDetail(detail: ArxivDetail): string {
  const publishedDate = detail.published ? detail.published.slice(0, 10) : null;
  return [
    `Title: ${detail.title}`,
    publishedDate ? `Meta: ${publishedDate}` : null,
    detail.authors.length > 0 ? `Authors: ${detail.authors.join(", ")}` : null,
    `Abstract: ${detail.abstract}`,
    `URL: ${detail.url}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function resolvePaperLookup(raw: string): {
  lookupId: string;
  label: string;
  arxivId: string | null;
} {
  const trimmed = raw.trim();
  const arxivFromUrl = trimmed.match(/arxiv\.org\/abs\/([^/?#\s]+)/i)?.[1];
  if (arxivFromUrl) {
    const arxivId = arxivFromUrl.replace(/v\d+$/i, "");
    return { lookupId: `ARXIV:${arxivId}`, label: `arXiv:${arxivId}`, arxivId };
  }

  const semanticScholarUrlId = trimmed.match(
    /semanticscholar\.org\/paper\/[^/?#\s]+\/([a-f0-9]{40})(?:[/?#\s]|$)/i,
  )?.[1];
  if (semanticScholarUrlId) {
    return {
      lookupId: semanticScholarUrlId,
      label: `Semantic Scholar:${semanticScholarUrlId.slice(0, 8)}`,
      arxivId: null,
    };
  }

  const corpusId = trimmed.match(/^CorpusID:(\d+)$/i)?.[1];
  if (corpusId) {
    return {
      lookupId: `CorpusId:${corpusId}`,
      label: `CorpusId:${corpusId}`,
      arxivId: null,
    };
  }

  const bareArxiv = trimmed.match(/^\d{4}\.\d{4,5}(v\d+)?$/i)?.[0];
  if (bareArxiv) {
    const arxivId = bareArxiv.replace(/v\d+$/i, "");
    return { lookupId: `ARXIV:${arxivId}`, label: `arXiv:${arxivId}`, arxivId };
  }

  return { lookupId: trimmed, label: trimmed, arxivId: null };
}

export const paperDetailsTool: ToolDefinition = {
  name: "paper_details",
  description:
    "Fetch the full abstract, TLDR (one-sentence Semantic Scholar summary), full author list, year, venue, citation count, and reference count for a paper given an arXiv id/URL, Semantic Scholar URL, Semantic Scholar paper id, CorpusID, or DOI. Use this in the Verify stage of discovery to confirm a candidate actually addresses the user's interest before recommending it — title alone is often misleading. Issue multiple calls in parallel to verify several candidates at once.",
  parameters: {
    type: "object",
    properties: {
      arxivId: {
        type: "string",
        description:
          "Paper identifier from search results: arXiv id like '2401.12345', full arXiv URL, Semantic Scholar URL/id, CorpusID, or DOI. Trailing arXiv version suffixes (v1, v2) are stripped automatically.",
      },
    },
    required: ["arxivId"],
  },

  async execute(input: Record<string, unknown>) {
    const raw = String(input.arxivId ?? "").trim();
    if (!raw) return { content: "Error: arxivId parameter is required.", ok: false };
    // Accept the identifiers that arxiv_search emits. Many search results are
    // Semantic Scholar-only rather than arXiv-indexed, so don't force ARXIV:*.
    const { lookupId, label, arxivId } = resolvePaperLookup(raw);

    try {
      const detail = await fetchS2(lookupId);
      if (!detail) {
        if (arxivId) {
          const arxiv = await fetchArxiv(arxivId);
          if (arxiv) return formatArxivDetail(arxiv);
        }
        return {
          content: `No details found for ${label}. The paper may not be indexed by Semantic Scholar.`,
          ok: false,
        };
      }

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
      const detailArxivId = detail.externalIds?.ArXiv?.replace(/v\d+$/i, "");
      lines.push(
        `URL: ${detailArxivId ? `https://arxiv.org/abs/${detailArxivId}` : detail.url}`,
      );
      return lines.join("\n\n");
    } catch (err) {
      if (arxivId) {
        try {
          const arxiv = await fetchArxiv(arxivId);
          if (arxiv) return formatArxivDetail(arxiv);
        } catch {
          // Keep the primary Semantic Scholar error below.
        }
      }
      return {
        content: `Failed to fetch paper details for ${label}: ${err instanceof Error ? err.message : "unknown error"}.`,
        ok: false,
      };
    }
  },
};
