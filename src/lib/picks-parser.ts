/**
 * Pure parser for the agent's `**Picks**` Markdown list. Used by:
 *   - Client UI (`picks-shared.tsx`) to split assistant text into pre/picks/post.
 *   - Server (`/api/discover-queries/.../finalize`) to extract Recommendation
 *     rows from the agent's final assistant text.
 *
 * No React, no DOM — safe to import from server code.
 */

// Lenient match: a heading line whose visible content (stripped of `#`,
// `*`, `_`, whitespace, and an optional "top/my/final/recommended"
// qualifier) is "Picks". Matches `**Picks**`, `## Picks`, `**Top Picks**`.
const PICKS_HEADING_RE =
  /^[#*_\s]*(?:my\s+|top\s+|final\s+|recommended\s+)?picks[#*_\s]*$/im;

const ITEM_START_RE = /^\s*(?:\d+\.|[-*])\s+(.*)$/;
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;

export interface ParsedPick {
  title: string;
  url: string;
  rationale: string;
  /** Optional arxiv id when the agent provided one explicitly (e.g. via
   *  the `submit_picks` tool). When not set, the server derives it from
   *  the URL. */
  arxivId?: string;
}

export interface ParsedPicksText {
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

export function arxivIdFromUrl(url: string): string | null {
  return url.match(/arxiv\.org\/abs\/([^/?#\s]+)/i)?.[1] ?? null;
}

export function parsePicks(text: string): ParsedPicksText | null {
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
    } else if (!trimmed) {
      flush();
    } else if (current) {
      current.rationale = (current.rationale + " " + trimmed).trim();
    } else if (picks.length > 0) {
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
