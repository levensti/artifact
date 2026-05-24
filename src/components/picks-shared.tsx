"use client";

/**
 * Shared rendering primitives for "curated picks" — the **Picks** list
 * format the discovery agent emits, and that the paper-reading agent
 * adopts when asked for a list of related papers.
 *
 * Used by both the discover panel and the reading-pane chat. The split:
 *   - discover-picks.tsx      → wraps these in DiscoverSteps + SearchChip
 *   - chat-step-renderers.tsx → wraps these in AgentSteps for reading-pane chat
 *   - chat-message-bubble.tsx → wraps these in InterleavedBlocks for persisted msgs
 */

import MarkdownMessage from "./markdown-message";
import {
  PaperCard,
  parseArxivSearchOutput,
  type PaperMeta,
} from "./discover-arxiv-cards";
import {
  arxivIdFromUrl,
  parsePicks,
  type ParsedPick,
} from "@/lib/picks-parser";
import type { AgentStep } from "@/hooks/use-chat";
import type { ChatAssistantBlock } from "@/lib/review-types";

/* ------------------------------------------------------------------ */
/*  Metadata pool                                                      */
/* ------------------------------------------------------------------ */

export interface MetadataPool {
  byUrl: Map<string, PaperMeta>;
  byArxivId: Map<string, PaperMeta>;
}

export const EMPTY_POOL: MetadataPool = {
  byUrl: new Map(),
  byArxivId: new Map(),
};

function canonicalUrl(url: string): string {
  if (!url) return "";
  return url.replace(/[?#].*$/, "").replace(/\/+$/, "").trim().toLowerCase();
}

function addToPool(pool: MetadataPool, p: PaperMeta) {
  const urlKey = canonicalUrl(p.url);
  if (urlKey && !pool.byUrl.has(urlKey)) pool.byUrl.set(urlKey, p);
  if (p.arxivId && !pool.byArxivId.has(p.arxivId))
    pool.byArxivId.set(p.arxivId, p);
}

/**
 * Parses the fixed plain-text format emitted by `web_search` (Exa) into
 * minimal `PaperMeta` shells so web-recommended links get cards too.
 */
function parseWebSearchOutput(output: string): PaperMeta[] {
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
      year: null,
      venue: null,
      citations: null,
      authors: "",
      abstract: descLines.join(" ").trim(),
    });
  }
  return out;
}

function ingestToolOutput(pool: MetadataPool, name: string, output: string) {
  if (!output) return;
  if (name === "arxiv_search") {
    const { papers } = parseArxivSearchOutput(output);
    for (const p of papers) addToPool(pool, p);
  } else if (name === "web_search") {
    for (const p of parseWebSearchOutput(output)) addToPool(pool, p);
  }
}

export function buildPoolFromSteps(steps: AgentStep[]): MetadataPool {
  const pool: MetadataPool = { byUrl: new Map(), byArxivId: new Map() };
  for (const step of steps) {
    if (step.kind === "tool_call" && step.output) {
      ingestToolOutput(pool, step.name, step.output);
    }
  }
  return pool;
}

export function buildPoolFromBlocks(blocks: ChatAssistantBlock[]): MetadataPool {
  const pool: MetadataPool = { byUrl: new Map(), byArxivId: new Map() };
  for (const block of blocks) {
    if (block.type === "tool_call" && block.output) {
      ingestToolOutput(pool, block.name, block.output);
    }
  }
  return pool;
}

/* ------------------------------------------------------------------ */
/*  PicksList                                                          */
/* ------------------------------------------------------------------ */

export function PicksList({
  picks,
  pool,
}: {
  picks: ParsedPick[];
  pool: MetadataPool;
}) {
  const cards: { meta: PaperMeta; rationale: string; key: string }[] = [];
  const seen = new Set<string>();

  for (const pick of picks) {
    const aid = arxivIdFromUrl(pick.url);
    const fromPool =
      (aid ? pool.byArxivId.get(aid) : undefined) ??
      pool.byUrl.get(canonicalUrl(pick.url)) ??
      null;

    const meta: PaperMeta = fromPool
      ? fromPool
      : /^https?:\/\//.test(pick.url)
        ? {
            title: pick.title,
            url: pick.url,
            arxivId: aid,
            year: null,
            venue: null,
            citations: null,
            authors: "",
            abstract: "",
          }
        : {
            title: pick.title,
            url: "",
            arxivId: null,
            year: null,
            venue: null,
            citations: null,
            authors: "",
            abstract: "",
          };

    const dedupeKey = meta.arxivId ?? canonicalUrl(meta.url) ?? meta.title;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    cards.push({ meta, rationale: pick.rationale, key: dedupeKey });
  }

  if (cards.length === 0) return null;

  return (
    <div className="my-2 space-y-2">
      <p
        className="text-[10.5px] font-mono uppercase"
        style={{
          letterSpacing: "0.18em",
          color: "color-mix(in srgb, var(--primary) 75%, transparent)",
        }}
      >
        Picks
      </p>
      <div className="grid grid-cols-1 gap-2">
        {cards.map((c) => (
          <PaperCard key={c.key} paper={c.meta} rationale={c.rationale} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TextWithPicks — text step renderer                                 */
/* ------------------------------------------------------------------ */

/**
 * Renders an assistant text segment. If the segment contains a **Picks**
 * heading followed by a Markdown list of `[Title](url)` items, splits the
 * text into pre / picks / post and renders the picks portion as cards
 * (looked up against `pool`). Otherwise falls through to plain Markdown.
 */
export function TextWithPicks({
  text,
  pool,
}: {
  text: string;
  pool: MetadataPool;
}) {
  if (!text) return null;
  const parsed = parsePicks(text);
  if (!parsed) {
    return <MarkdownMessage content={text} />;
  }
  return (
    <>
      {parsed.pre ? <MarkdownMessage content={parsed.pre} /> : null}
      <PicksList picks={parsed.picks} pool={pool} />
      {parsed.post ? <MarkdownMessage content={parsed.post} /> : null}
    </>
  );
}
