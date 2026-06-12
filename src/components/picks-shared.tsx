"use client";

/**
 * Shared rendering primitives for "curated picks" — the **Picks** list
 * format the discovery agent emits, and that the paper-reading agent
 * adopts when asked for a list of related papers.
 *
 * Used by both the discover panel and the reading-pane chat. The split:
 *   - discover-picks.tsx      → renders these in the live research timeline
 *   - chat-step-renderers.tsx → wraps these in AgentSteps for reading-pane chat
 *   - chat-message-bubble.tsx → wraps these in InterleavedBlocks for persisted msgs
 */

import MarkdownMessage from "./markdown-message";
import { PaperCard } from "./discover-arxiv-cards";
import {
  arxivIdFromUrl,
  parsePicks,
  type ParsedPick,
} from "@/lib/picks-parser";
import type { AgentStep } from "@/hooks/use-chat";
import type { ChatAssistantBlock } from "@/lib/review-types";
import {
  buildPaperMetadataPool,
  canonicalUrl,
  type MetadataPool,
  type PaperMeta,
} from "@/lib/discover-paper-metadata";

/* ------------------------------------------------------------------ */
/*  Metadata pool                                                      */
/* ------------------------------------------------------------------ */

export function buildPoolFromSteps(steps: AgentStep[]): MetadataPool {
  return buildPaperMetadataPool(steps);
}

export function buildPoolFromBlocks(blocks: ChatAssistantBlock[]): MetadataPool {
  return buildPaperMetadataPool(
    blocks.map((block) => ({
      kind: block.type,
      name: block.type === "tool_call" ? block.name : undefined,
      output: block.type === "tool_call" ? block.output : undefined,
    })),
  );
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
            publishedDate: null,
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
            publishedDate: null,
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
