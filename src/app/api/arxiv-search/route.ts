import { NextRequest, NextResponse } from "next/server";
import type { ArxivSearchResult } from "@/lib/explore";

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

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query")?.trim();
  const maxResultsRaw = request.nextUrl.searchParams.get("max_results") ?? "15";
  const maxResults = Math.max(1, Math.min(30, Number.parseInt(maxResultsRaw, 10) || 15));

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter" }, { status: 400 });
  }

  const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

  try {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
      response = await fetch(url, {
        headers: {
          "User-Agent": "PaperCopilot/1.0 (academic research tool; mailto:contact@paper-copilot.dev)",
        },
        next: { revalidate: 3600 },
      });
      if (response.status !== 429) break;
    }

    if (!response || !response.ok) {
      return NextResponse.json({ error: "Failed to query arXiv" }, { status: 502 });
    }

    const xml = await response.text();
    const entries = xml.split("<entry>").slice(1).map((part) => `<entry>${part}`);

    const results: ArxivSearchResult[] = entries.map((entry) => {
      const idRaw = extractTag(entry, "id") ?? "";
      const arxivId = (idRaw.match(/\/abs\/([^v<\s]+)/)?.[1] ?? "").trim();

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
    });

    const deduped = results.filter((item) => item.arxivId && item.title);
    return NextResponse.json({ results: deduped });
  } catch {
    return NextResponse.json({ error: "Failed to query arXiv" }, { status: 500 });
  }
}
