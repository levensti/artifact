import { NextRequest, NextResponse } from "next/server";
import type { ArxivSearchResult } from "@/lib/explore";
import { auth } from "@/server/auth";
import * as store from "@/server/store";

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

interface ExaResult {
  title?: string | null;
  url?: string | null;
  id?: string | null;
  author?: string | null;
  publishedDate?: string | null;
  text?: string | null;
}

interface ExaSearchResponse {
  results?: ExaResult[];
}

const ARXIV_USER_AGENT = "Artifact/1.0 (academic research tool)";

function extractArxivIdFromExaResult(result: ExaResult): string | null {
  const candidates = [result.id, result.url].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  for (const raw of candidates) {
    const match = raw.match(
      /(?:arxiv\.org|ar5iv\.labs\.arxiv\.org)\/(?:abs|pdf|html)\/(\d+\.\d+)(?:v\d+)?(?:\.pdf)?/i,
    );
    if (match) return match[1].toLowerCase();
  }

  return null;
}

async function resolveExaApiKey(): Promise<string | null> {
  const envKey = process.env.EXA_API_KEY?.trim();
  if (envKey) return envKey;

  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return null;
    const settings = await store.getSettings(userId);
    return settings.exaApiKey?.trim() || null;
  } catch {
    return null;
  }
}

async function searchExaArxiv(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<string[]> {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      includeDomains: ["arxiv.org"],
      category: "research paper",
      numResults: Math.min(100, Math.max(maxResults * 3, 20)),
      type: "auto",
      contents: { text: { maxCharacters: 800 } },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Exa Search API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as ExaSearchResponse;
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const item of data.results ?? []) {
    const arxivId = extractArxivIdFromExaResult(item);
    if (!arxivId || seen.has(arxivId)) continue;
    seen.add(arxivId);
    ids.push(arxivId);
    if (ids.length >= maxResults) break;
  }

  return ids;
}

function parseArxivEntries(xml: string): ArxivSearchResult[] {
  const entries = xml.split("<entry>").slice(1).map((part) => `<entry>${part}`);

  return entries
    .map((entry) => {
      const idRaw = extractTag(entry, "id") ?? "";
      const arxivId = (idRaw.match(/\/abs\/([^v<\s]+)/)?.[1] ?? "")
        .trim()
        .toLowerCase();

      const title = (extractTag(entry, "title") ?? "").replace(/\s+/g, " ").trim();
      const abstract = (extractTag(entry, "summary") ?? "").replace(/\s+/g, " ").trim();
      const publishedDate = extractTag(entry, "published") ?? "";
      const authors = extractAll(entry, /<name>([\s\S]*?)<\/name>/g);
      const categories = extractAll(entry, /<category[^>]*term="([^"]+)"/g);

      return {
        arxivId,
        title,
        abstract,
        authors,
        publishedDate,
        categories,
      };
    })
    .filter((item) => item.arxivId && item.title);
}

async function fetchArxivMetadataByIds(
  arxivIds: string[],
): Promise<ArxivSearchResult[]> {
  if (arxivIds.length === 0) return [];
  const uniqueIds = [...new Set(arxivIds)];
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(uniqueIds.join(","))}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": ARXIV_USER_AGENT,
    },
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`arXiv metadata lookup failed (${response.status})`);
  }

  const byId = new Map(
    parseArxivEntries(await response.text()).map((result) => [
      result.arxivId,
      result,
    ]),
  );

  return uniqueIds
    .map((id) => byId.get(id))
    .filter((result): result is ArxivSearchResult => Boolean(result));
}

async function searchArxivApi(
  query: string,
  maxResults: number,
): Promise<ArxivSearchResult[] | NextResponse> {
  const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
    response = await fetch(url, {
      headers: {
        "User-Agent": ARXIV_USER_AGENT,
      },
      next: { revalidate: 3600 },
    });
    if (response.status !== 429) break;
  }

  if (!response || !response.ok) {
    return NextResponse.json({ error: "Failed to query arXiv" }, { status: 502 });
  }

  const xml = await response.text();
  return parseArxivEntries(xml);
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query")?.trim();
  const maxResultsRaw = request.nextUrl.searchParams.get("max_results") ?? "15";
  const maxResults = Math.max(1, Math.min(30, Number.parseInt(maxResultsRaw, 10) || 15));

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter" }, { status: 400 });
  }

  try {
    const exaApiKey = await resolveExaApiKey();
    if (exaApiKey) {
      try {
        const exaRankedIds = await searchExaArxiv(query, maxResults, exaApiKey);
        const exaResults = await fetchArxivMetadataByIds(exaRankedIds);
        if (exaResults.length > 0) {
          return NextResponse.json({ results: exaResults });
        }
      } catch (error) {
        console.warn(
          "Exa arXiv search failed; falling back to arXiv API:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    const results = await searchArxivApi(query, maxResults);
    if (results instanceof NextResponse) return results;
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Failed to query arXiv" }, { status: 500 });
  }
}
