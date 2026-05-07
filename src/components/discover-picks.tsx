"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownMessage from "./markdown-message";
import { ThinkingIndicator } from "./chat-step-renderers";
import BraveKeyPromptCard from "./brave-key-prompt-card";
import { BRAVE_KEY_REQUIRED_SENTINEL } from "@/tools/web-search";
import {
  PaperCard,
  parseArxivSearchOutput,
  type PaperMeta,
} from "./discover-arxiv-cards";
import type { AgentStep } from "@/hooks/use-chat";

/* ------------------------------------------------------------------ */
/*  Metadata pool                                                      */
/*                                                                     */
/*  Built from every `tool_result` output in the assistant message.    */
/*  Curated picks reference papers by URL; we look up the URL here to  */
/*  get the full metadata (year/venue/citations/authors/abstract).     */
/* ------------------------------------------------------------------ */

interface MetadataPool {
  byUrl: Map<string, PaperMeta>;
  byArxivId: Map<string, PaperMeta>;
}

function canonicalUrl(url: string): string {
  if (!url) return "";
  return url.replace(/[?#].*$/, "").replace(/\/+$/, "").trim().toLowerCase();
}

function arxivIdFromUrl(url: string): string | null {
  return url.match(/arxiv\.org\/abs\/([^/?#\s]+)/i)?.[1] ?? null;
}

function addToPool(pool: MetadataPool, p: PaperMeta) {
  const urlKey = canonicalUrl(p.url);
  if (urlKey && !pool.byUrl.has(urlKey)) pool.byUrl.set(urlKey, p);
  if (p.arxivId && !pool.byArxivId.has(p.arxivId))
    pool.byArxivId.set(p.arxivId, p);
}

/**
 * Parses the fixed plain-text format emitted by `web_search` (Brave) into
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

function buildPool(steps: AgentStep[]): MetadataPool {
  const pool: MetadataPool = { byUrl: new Map(), byArxivId: new Map() };
  for (const step of steps) {
    if (step.kind !== "tool_call" || !step.output) continue;
    if (step.name === "arxiv_search") {
      const { papers } = parseArxivSearchOutput(step.output);
      for (const p of papers) addToPool(pool, p);
    } else if (step.name === "web_search") {
      for (const p of parseWebSearchOutput(step.output)) addToPool(pool, p);
    }
  }
  return pool;
}

/* ------------------------------------------------------------------ */
/*  Picks parser                                                       */
/* ------------------------------------------------------------------ */

// Lenient match: a heading line whose visible content (stripped of `#`,
// `*`, `_`, whitespace, and an optional "top/my/final" qualifier) is
// "Picks". Matches `**Picks**`, `## Picks`, `**Top Picks**`, etc.
const PICKS_HEADING_RE =
  /^[#*_\s]*(?:my\s+|top\s+|final\s+|recommended\s+)?picks[#*_\s]*$/im;

const ITEM_START_RE = /^\s*(?:\d+\.|[-*])\s+(.*)$/;
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;

interface ParsedPick {
  title: string;
  url: string;
  rationale: string;
}

interface ParsedText {
  pre: string;
  picks: ParsedPick[];
  post: string;
}

function stripLeadingSeparator(s: string): string {
  return s.replace(/^[—–\-:]\s*/, "").trim();
}

function stripBoldStars(s: string): string {
  return s.replace(/^\*+|\*+$/g, "").trim();
}

function parsePicks(text: string): ParsedText | null {
  const m = PICKS_HEADING_RE.exec(text);
  if (!m) return null;
  const headingStart = m.index;
  const headingEnd = headingStart + m[0].length;
  const pre = text.slice(0, headingStart).trimEnd();
  const after = text.slice(headingEnd);

  // Walk lines after the heading. Items are list lines with a markdown link.
  // Continuation lines (non-blank, non-item) attach to the current pick as
  // multi-line rationale. Blank lines flush the current pick but don't end
  // the list (the agent often separates items with blank lines). The list
  // ends when we hit a non-blank, non-list-item line and there's no
  // current pick open — i.e., trailing prose after the picks.
  const picks: ParsedPick[] = [];
  let current: ParsedPick | null = null;
  let endIdx = -1;
  const lines = after.split("\n");
  let cursor = 0;

  const flush = () => {
    if (current) {
      current.rationale = current.rationale.trim();
      picks.push(current);
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    const itemMatch = ITEM_START_RE.exec(rawLine);

    if (itemMatch) {
      flush();
      const inner = itemMatch[1];
      const linkMatch = LINK_RE.exec(inner);
      if (linkMatch) {
        const title = stripBoldStars(linkMatch[1]);
        const url = linkMatch[2].trim();
        const tail = inner.slice(linkMatch.index + linkMatch[0].length);
        current = {
          title,
          url,
          rationale: stripLeadingSeparator(stripBoldStars(tail)),
        };
      }
      // Item without a link → drop, but keep the list open.
    } else if (!trimmed) {
      flush();
    } else if (current) {
      current.rationale = (current.rationale + " " + trimmed).trim();
    } else if (picks.length > 0) {
      // Trailing prose after the picks list.
      endIdx = cursor;
      break;
    }
    cursor += rawLine.length + 1;
  }
  flush();

  if (picks.length === 0) return null;

  const post = endIdx >= 0 ? after.slice(endIdx).trim() : "";
  return { pre, picks, post };
}

/* ------------------------------------------------------------------ */
/*  Picks list — one or more rich cards with rationales                */
/* ------------------------------------------------------------------ */

function PicksList({
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
            // URL the agent emitted but no metadata in the pool. Could be a
            // hallucinated arXiv ID, an external link, or a paper not in the
            // searches we actually ran. Render as a degraded card so the
            // user can still click through, but flag the missing metadata
            // by leaving year/venue/authors empty.
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
            // No usable URL at all — fall back to a card with title only.
            title: pick.title,
            url: "",
            arxivId: null,
            year: null,
            venue: null,
            citations: null,
            authors: "",
            abstract: "",
          };

    // Dedupe — same paper recommended via two URLs / two queries.
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
/*  Search chip — collapsed tool_call with cards in expanded pane      */
/* ------------------------------------------------------------------ */

function resultCount(name: string, output: string | undefined): number | null {
  if (!output) return null;
  if (name === "arxiv_search") {
    const m = output.match(/^Found (\d+) papers/m);
    return m ? Number(m[1]) : null;
  }
  if (name === "web_search") {
    const m = output.match(/^Found (\d+) web results/m);
    return m ? Number(m[1]) : null;
  }
  return null;
}

function SearchChip({
  name,
  input,
  output,
}: {
  name: string;
  input: Record<string, unknown>;
  output?: string;
}) {
  const [open, setOpen] = useState(false);

  if (name === "web_search" && output?.trim() === BRAVE_KEY_REQUIRED_SENTINEL) {
    return <BraveKeyPromptCard />;
  }

  const done = !!output;
  const trimmedOutput = (output ?? "").trim();
  const failed =
    done &&
    /^(?:error:|paper search failed:|web search failed:|request failed:|no papers found|no web results)/i.test(
      trimmedOutput,
    );
  const queryStr =
    "query" in input && input.query ? String(input.query) : null;
  const count = done ? resultCount(name, output) : null;
  const displayName = name === "web_search" ? "web" : "papers";

  // Expanded pane content. For arxiv_search, render the same card list the
  // legacy `DiscoverArxivCards` rendered (so the user can browse the full
  // candidate set behind the chip). For web_search, fall back to raw text.
  const expanded = !output ? null : name === "arxiv_search" ? (
    (() => {
      const { papers } = parseArxivSearchOutput(output);
      if (papers.length === 0) {
        return (
          <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground/80 leading-relaxed">
            {output.trim()}
          </pre>
        );
      }
      return (
        <div className="grid grid-cols-1 gap-2">
          {papers.map((p, i) => (
            <PaperCard key={`${p.url || p.title}-${i}`} paper={p} />
          ))}
        </div>
      );
    })()
  ) : (
    <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground/80 leading-relaxed">
      {output.trim()}
    </pre>
  );

  return (
    <div className="my-1.5 rounded-md border border-border/70 bg-muted/15 text-xs overflow-hidden">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors",
          done && "hover:bg-muted/30 cursor-pointer",
          !done && "cursor-default",
        )}
        onClick={() => done && setOpen((v) => !v)}
        disabled={!done}
      >
        {done ? (
          failed ? (
            <X className="size-3 text-destructive shrink-0" strokeWidth={2.5} />
          ) : (
            <Check className="size-3 text-success shrink-0" strokeWidth={2.5} />
          )
        ) : (
          <Loader2 className="size-3 text-primary/60 animate-spin shrink-0" />
        )}
        {name === "web_search" ? (
          <Globe className="size-3 text-muted-foreground/70 shrink-0" />
        ) : (
          <Search className="size-3 text-muted-foreground/70 shrink-0" />
        )}
        <span
          className={cn(
            "font-medium",
            failed ? "text-destructive/90" : "text-foreground/80",
          )}
        >
          {done ? "Searched" : "Searching"} {displayName}
        </span>
        {queryStr ? (
          <span className="truncate max-w-[28ch] text-muted-foreground/70">
            · &ldquo;{queryStr}&rdquo;
          </span>
        ) : null}
        {count !== null ? (
          <span className="text-muted-foreground/60 shrink-0">
            · {count} results
          </span>
        ) : null}
        {done ? (
          <span className="ml-auto text-muted-foreground/50 shrink-0">
            {open ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </span>
        ) : null}
      </button>
      {open && expanded ? (
        <div className="border-t border-border/40 bg-muted/5 px-2.5 py-2 max-h-[28rem] overflow-y-auto">
          {expanded}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Text step renderer — splits on **Picks** heading                   */
/* ------------------------------------------------------------------ */

function DiscoverText({
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

/* ------------------------------------------------------------------ */
/*  Public: DiscoverSteps                                              */
/* ------------------------------------------------------------------ */

export default function DiscoverSteps({ steps }: { steps: AgentStep[] }) {
  const pool = useMemo(() => buildPool(steps), [steps]);

  return (
    <>
      {steps.map((step, i) => {
        switch (step.kind) {
          case "thinking":
            return <ThinkingIndicator key={`think-${i}`} />;
          case "tool_call":
            return (
              <SearchChip
                key={step.id}
                name={step.name}
                input={step.input}
                output={step.output}
              />
            );
          case "text":
            return (
              <DiscoverText key={`text-${i}`} text={step.text} pool={pool} />
            );
        }
      })}
    </>
  );
}
