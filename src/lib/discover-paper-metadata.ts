import { arxivIdFromUrl } from "@/lib/picks-parser";

export interface PaperMeta {
  title: string;
  url: string;
  arxivId: string | null;
  publishedDate: string | null;
  year: string | null;
  venue: string | null;
  citations: string | null;
  authors: string;
  abstract: string;
}

export interface MetadataPool {
  byUrl: Map<string, PaperMeta>;
  byArxivId: Map<string, PaperMeta>;
}

export const EMPTY_POOL: MetadataPool = {
  byUrl: new Map(),
  byArxivId: new Map(),
};

export function canonicalUrl(url: string): string {
  if (!url) return "";
  return url.replace(/[?#].*$/, "").replace(/\/+$/, "").trim().toLowerCase();
}

function mergePaperMeta(existing: PaperMeta, incoming: PaperMeta): PaperMeta {
  return {
    title: incoming.title || existing.title,
    url: incoming.url || existing.url,
    arxivId: incoming.arxivId ?? existing.arxivId,
    publishedDate: incoming.publishedDate ?? existing.publishedDate,
    year: incoming.year ?? existing.year,
    venue: incoming.venue ?? existing.venue,
    citations: incoming.citations ?? existing.citations,
    authors: incoming.authors || existing.authors,
    abstract: incoming.abstract || existing.abstract,
  };
}

export function addToPool(pool: MetadataPool, p: PaperMeta) {
  const urlKey = canonicalUrl(p.url);
  if (urlKey) {
    const existing = pool.byUrl.get(urlKey);
    pool.byUrl.set(urlKey, existing ? mergePaperMeta(existing, p) : p);
  }
  if (p.arxivId) {
    const existing = pool.byArxivId.get(p.arxivId);
    pool.byArxivId.set(p.arxivId, existing ? mergePaperMeta(existing, p) : p);
  }
}

/**
 * Parses the fixed plain-text format emitted by `arxiv_search` into
 * structured cards. See `src/tools/arxiv-search.ts` for the output shape.
 */
export function parseArxivSearchOutput(output: string): {
  header: string | null;
  papers: PaperMeta[];
} {
  const trimmed = output.trim();
  if (!trimmed) return { header: null, papers: [] };

  const firstEntryIdx = trimmed.search(/^\[1\] /m);
  const header = firstEntryIdx > 0 ? trimmed.slice(0, firstEntryIdx).trim() : null;
  const body = firstEntryIdx >= 0 ? trimmed.slice(firstEntryIdx) : trimmed;

  const entries = body
    .split(/\n\n(?=\[\d+\] )/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const papers: PaperMeta[] = [];
  for (const entry of entries) {
    const lines = entry.split("\n");
    const titleMatch = lines[0]?.match(/^\[\d+\] (.+)$/);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();

    let url = "";
    let metaPart = "";
    let authors = "";
    let publishedDate: string | null = null;
    const abstractLines: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].replace(/^\s{4}/, "").trimEnd();
      if (!line) continue;
      if (!url && /^https?:\/\//.test(line)) {
        const [u, ...meta] = line.split(" | ");
        url = u.trim();
        metaPart = meta.join(" | ").trim();
      } else if (line.startsWith("Authors: ")) {
        authors = line.slice("Authors: ".length).trim();
      } else {
        abstractLines.push(line);
      }
    }

    const metaTokens = metaPart
      ? metaPart.split(" · ").map((s) => s.trim()).filter(Boolean)
      : [];
    let year: string | null = null;
    let citations: string | null = null;
    let venue: string | null = null;
    for (const tok of metaTokens) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) {
        publishedDate = tok;
        year = tok.slice(0, 4);
      } else if (/^\d{4}$/.test(tok)) year = tok;
      else if (/citations?$/i.test(tok)) citations = tok;
      else venue = tok;
    }

    papers.push({
      title,
      url,
      arxivId: arxivIdFromUrl(url),
      publishedDate,
      year,
      venue,
      citations,
      authors,
      abstract: abstractLines.join(" ").trim(),
    });
  }

  return { header, papers };
}

/**
 * Parses the fixed plain-text format emitted by `web_search` (Exa) into
 * minimal `PaperMeta` shells so web-recommended links can still render cards.
 */
export function parseWebSearchOutput(output: string): PaperMeta[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  const firstIdx = trimmed.search(/^\[1\] /m);
  if (firstIdx < 0) return [];
  const body = trimmed.slice(firstIdx);
  const entries = body
    .split(/\n\n(?=\[\d+\] )/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: PaperMeta[] = [];
  for (const entry of entries) {
    const lines = entry.split("\n");
    const titleMatch = lines[0]?.match(/^\[\d+\] (.+)$/);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();

    let url = "";
    const descLines: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].replace(/^\s{4}/, "").trimEnd();
      if (!line) continue;
      if (line.startsWith("URL: ")) url = line.slice(5).trim();
      else descLines.push(line);
    }

    out.push({
      title,
      url,
      arxivId: arxivIdFromUrl(url),
      publishedDate: null,
      year: null,
      venue: null,
      citations: null,
      authors: "",
      abstract: descLines.join(" ").trim(),
    });
  }
  return out;
}

export function parsePaperDetailsOutput(output: string): PaperMeta | null {
  const trimmed = output.trim();
  if (!trimmed || /^(?:failed|no details|error):?/i.test(trimmed)) return null;

  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  let title = "";
  let url = "";
  let authors = "";
  let publishedDate: string | null = null;
  let year: string | null = null;
  let venue: string | null = null;
  let citations: string | null = null;
  let abstract = "";

  for (const line of lines) {
    if (line.startsWith("Title: ")) {
      title = line.slice("Title: ".length).trim();
    } else if (line.startsWith("Meta: ")) {
      const tokens = line
        .slice("Meta: ".length)
        .split(" · ")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const tok of tokens) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) {
          publishedDate = tok;
          year = tok.slice(0, 4);
        } else if (/^\d{4}$/.test(tok)) year = tok;
        else if (/citations?$/i.test(tok)) citations = tok;
        else if (!/references?$/i.test(tok)) venue = tok;
      }
    } else if (line.startsWith("Authors: ")) {
      authors = line.slice("Authors: ".length).trim();
    } else if (line.startsWith("Abstract: ")) {
      abstract = line.slice("Abstract: ".length).trim();
    } else if (line.startsWith("URL: ")) {
      url = line.slice("URL: ".length).trim();
    }
  }

  if (!title && !url) return null;
  return {
    title,
    url,
    arxivId: arxivIdFromUrl(url),
    publishedDate,
    year,
    venue,
    citations,
    authors,
    abstract,
  };
}

export function ingestToolOutput(
  pool: MetadataPool,
  name: string,
  output: string,
) {
  if (!output) return;
  if (name === "arxiv_search") {
    const { papers } = parseArxivSearchOutput(output);
    for (const p of papers) addToPool(pool, p);
  } else if (name === "web_search") {
    for (const p of parseWebSearchOutput(output)) addToPool(pool, p);
  } else if (name === "paper_details") {
    const details = parsePaperDetailsOutput(output);
    if (details) addToPool(pool, details);
  }
}

export function buildPaperMetadataPool(
  steps: Array<{ kind: string; name?: string; output?: string }>,
): MetadataPool {
  const pool: MetadataPool = { byUrl: new Map(), byArxivId: new Map() };
  for (const step of steps) {
    if (step.kind === "tool_call" && step.name && step.output) {
      ingestToolOutput(pool, step.name, step.output);
    }
  }
  return pool;
}
