/**
 * Resolve citation tokens (§N, Fig. N, Ref. [key]) to a page number and
 * tooltip text using a page map (from the per-page LLM pass for short
 * papers, or the server's section tree for long ones) and the paper's
 * extracted text.
 *
 * The extracted text from `pdfjs-dist` is annotated with `[Page N]` markers
 * at every page boundary; we use those as the ground truth for "what page
 * does this thing live on?" The page map is consulted first when present,
 * and we always fall back to scanning the raw text.
 */

import type { PageMap } from "@/lib/review-types";

export interface CitationResolution {
  page?: number;
  tooltip?: string;
  /**
   * Verbatim text candidates at the match site (heading/caption start), used
   * to locate the exact spot inside the rendered page's text layer. The first
   * candidate is preferred; later candidates are fallbacks.
   */
  anchorText?: string | string[];
}

const PAGE_MARKER_RE = /\[Page (\d+)\]/g;

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function resolveSection(
  sectionNum: string,
  paperText: string | null | undefined,
  pageMap: PageMap | null = null,
): CitationResolution {
  const mapped = pageMap?.sections?.[sectionNum];
  const mappedAnchor = pageMap?.anchors?.sections?.[sectionNum];
  if (paperText) {
    const fromText = findSectionInText(paperText, sectionNum) ?? {};
    return {
      page: mapped ?? fromText.page,
      tooltip: fromText.tooltip ?? mappedAnchor,
      anchorText: anchorCandidates(mappedAnchor, fromText.anchorText),
    };
  }
  return mapped ? { page: mapped, tooltip: mappedAnchor, anchorText: mappedAnchor } : {};
}

export function resolveFigure(
  figureNum: string,
  paperText: string | null | undefined,
  pageMap: PageMap | null = null,
): CitationResolution {
  const mapped = pageMap?.figures?.[figureNum];
  const mappedAnchor = pageMap?.anchors?.figures?.[figureNum];
  if (paperText) {
    const fromText = findFigureInText(paperText, figureNum) ?? {};
    return {
      page: mapped ?? fromText.page,
      tooltip: fromText.tooltip,
      anchorText: anchorCandidates(mappedAnchor, fromText.anchorText),
    };
  }
  return mapped ? { page: mapped, anchorText: mappedAnchor } : {};
}

export function resolveTable(
  num: string,
  paperText: string | null | undefined,
  pageMap: PageMap | null = null,
): CitationResolution {
  const mapped = pageMap?.tables?.[num];
  const mappedAnchor = pageMap?.anchors?.tables?.[num];
  if (paperText) {
    const fromText = findTableInText(paperText, num) ?? {};
    return {
      page: mapped ?? fromText.page,
      tooltip: fromText.tooltip,
      anchorText: anchorCandidates(mappedAnchor, fromText.anchorText),
    };
  }
  return mapped ? { page: mapped, anchorText: mappedAnchor } : {};
}

export function resolveReference(
  key: string,
  paperText: string | null | undefined,
): CitationResolution {
  if (paperText) return findReferenceInText(paperText, key) ?? {};
  return {};
}

/* ------------------------------------------------------------------ */
/*  Raw-text scanning (fallback)                                       */
/* ------------------------------------------------------------------ */

/**
 * Find a section heading in the paper text. PDF text from `pdfjs-dist`
 * concatenates all items on a page with single spaces — there are no
 * newlines within a page. So we can't anchor on line starts; we have to
 * recognize the heading position in continuous prose.
 *
 * Strategy: find every standalone occurrence of the section number, skip
 * the ones that are clearly in-text references (preceded by "Section",
 * "§", "in", "see", etc.), and take the FIRST remaining match — the
 * heading appears before any references to it in document order.
 */
function findSectionInText(
  paperText: string,
  num: string,
  knownHeading?: string,
): CitationResolution | null {
  if (knownHeading) {
    const idx = paperText.indexOf(knownHeading);
    if (idx >= 0) {
      return {
        page: pageAt(paperText, idx),
        tooltip: knownHeading,
        anchorText: knownHeading,
      };
    }
  }

  const escNum = escapeRegex(num);
  // Match the bare number with surrounding boundaries: not part of a
  // larger number like "14.2" or "4.20", not in a decimal context.
  const occurrenceRe = new RegExp(
    `(?<![\\d.])${escNum}(?![\\d.])`,
    "g",
  );

  let match: RegExpExecArray | null;
  while ((match = occurrenceRe.exec(paperText)) !== null) {
    if (isSectionReference(paperText, match.index)) continue;
    // Try to grab a heading title from the text immediately after the
    // number. Common shapes: "4.2 Title Words" or "4.2. Title Words".
    const after = paperText.slice(
      match.index + match[0].length,
      match.index + match[0].length + 120,
    );
    const titleMatch = after.match(
      /^[\s.:]+([A-Z][A-Za-z0-9-]*(?:[\s-][A-Za-z][A-Za-z0-9-]*){0,8})/,
    );
    const heading = titleMatch
      ? `${num} ${titleMatch[1].trim()}`
      : `Section ${num}`;
    return {
      page: pageAt(paperText, match.index),
      tooltip: heading,
      anchorText: anchorAt(paperText, match.index),
    };
  }

  return null;
}

const SECTION_REFERENCE_BEFORE = [
  "section",
  "section.",
  "sec",
  "sec.",
  "§",
  "in",
  "see",
  "of",
  "from",
  "and",
  "or",
  "to",
  "via",
  "table",
  "fig",
  "fig.",
  "figure",
  "eq",
  "eq.",
  "equation",
];

/**
 * True if the offset in `text` looks like a reference TO a section
 * (e.g. "in 3.2", "Section 3.2") rather than the section heading itself.
 * We check the ~30 chars before the match for tell-tale words.
 */
function isSectionReference(text: string, pos: number): boolean {
  const start = Math.max(0, pos - 30);
  const before = text.slice(start, pos).toLowerCase();
  // Last word before the match.
  const trailingWord = before.match(/(\S+)\s*$/)?.[1] ?? "";
  return SECTION_REFERENCE_BEFORE.includes(trailingWord);
}

function findFigureInText(
  paperText: string,
  num: string,
  preferredPage?: number,
): CitationResolution | null {
  return findCaptionInText(paperText, `Fig(?:ure)?\\.?`, "Figure", num, preferredPage);
}

function findTableInText(
  paperText: string,
  num: string,
  preferredPage?: number,
): CitationResolution | null {
  return findCaptionInText(paperText, "Table", "Table", num, preferredPage);
}

/**
 * Find a figure/table caption in the paper text. Captions punctuate right
 * after the number ("Table 3: …", "Fig. 2. …") while in-text references
 * don't ("in Table 3 rows (B)…", "table 3), step time…") — so require the
 * colon/period. Among caption-shaped matches, prefer one on `preferredPage`
 * (the page-map's answer) when given: a sentence ending in "…in Table 3."
 * is caption-shaped too, and the page map is the more trustworthy signal
 * for which page the element actually lives on.
 */
function findCaptionInText(
  paperText: string,
  labelPattern: string,
  label: string,
  num: string,
  preferredPage?: number,
): CitationResolution | null {
  const escNum = escapeRegex(num);
  // Colon first: "Table 3: …" is the dominant caption style and prose never
  // writes it. Period form ("Table 3. …") is a real style too, but it also
  // matches sentence-final mentions ("…shown in Table 3. Next we…"), so it
  // only gets a shot when no colon caption exists anywhere.
  let candidates: RegExpExecArray[] = [];
  for (const punct of [":", "\\."]) {
    const captionRe = new RegExp(
      `(?:^|\\s)${labelPattern}\\s+${escNum}\\s*${punct}\\s+(.{10,400})`,
      "gi",
    );
    candidates = [...paperText.matchAll(captionRe)];
    if (candidates.length > 0) break;
  }
  const chosen =
    (preferredPage !== undefined
      ? candidates.find((m) => pageAt(paperText, m.index) === preferredPage)
      : undefined) ?? candidates[0];
  if (chosen) {
    const caption = `${label} ${num}: ${chosen[1].trim().split(/(?<=[.])\s/)[0]}`;
    return {
      page: pageAt(paperText, chosen.index),
      tooltip: shorten(caption, 200),
      anchorText: anchorAt(paperText, chosen.index),
    };
  }

  // Last resort: any mention, with the same preferred-page bias.
  const mentionRe = new RegExp(`(?:^|\\s)${labelPattern}\\s+${escNum}\\b`, "gi");
  const mentions = [...paperText.matchAll(mentionRe)];
  const mention =
    (preferredPage !== undefined
      ? mentions.find((m) => pageAt(paperText, m.index) === preferredPage)
      : undefined) ?? mentions[0];
  if (mention) {
    // A bare mention is a weak page signal — keep the page map's answer
    // when it has one. The anchor is still useful: if the mention isn't on
    // the final page the text-layer search just misses and the viewer falls
    // back to a page-level scroll.
    return {
      page: preferredPage ?? pageAt(paperText, mention.index),
      anchorText: anchorAt(paperText, mention.index),
    };
  }
  return null;
}

/**
 * Find a reference in the paper's bibliography. The bibliography sits at
 * the end of the paper (after a "References" / "Bibliography" header), so
 * we scope the search to that suffix when we can find it. For numeric refs
 * like [27] we look for "[27] Author, ..." in the suffix; for author-year
 * keys ("Vaswani2017") we look for the surname.
 */
function findReferenceInText(
  paperText: string,
  key: string,
): CitationResolution | null {
  const biblioStart = findBibliographyStart(paperText);
  const haystack =
    biblioStart >= 0 ? paperText.slice(biblioStart) : paperText;

  if (/^\d+$/.test(key)) {
    // Numeric: scan for "[27]" followed by typical reference content. We
    // match the LAST occurrence in the bibliography region (skipping any
    // in-text reuse). The reference body is from "[27]" to the next "[N]".
    const re = new RegExp(`\\[${key}\\]\\s*([^\\[]{10,500})`, "g");
    let last: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = re.exec(haystack)) !== null) {
      last = match;
    }
    if (last) {
      const text = last[1].trim().replace(/\s+/g, " ");
      const refIndex = (biblioStart >= 0 ? biblioStart : 0) + last.index;
      return {
        page: pageAt(paperText, refIndex),
        tooltip: shorten(text, 250),
        anchorText: anchorAt(paperText, refIndex),
      };
    }
    return null;
  }

  // Author-year key like "Vaswani2017" or "VaswaniEtAl2017".
  const surname = key.replace(/\d+$/, "").replace(/(?:Etal|EtAl)$/i, "").trim();
  if (surname.length >= 3) {
    const idx = haystack.toLowerCase().indexOf(surname.toLowerCase());
    if (idx >= 0) {
      const snippet = haystack.slice(idx, idx + 300).replace(/\s+/g, " ");
      const refIndex = (biblioStart >= 0 ? biblioStart : 0) + idx;
      return {
        page: pageAt(paperText, refIndex),
        tooltip: shorten(snippet.trim(), 250),
        anchorText: anchorAt(paperText, refIndex),
      };
    }
  }
  return null;
}

/**
 * Locate the start of the bibliography. Looks for "References",
 * "Bibliography", or "Works Cited" in the latter half of the paper.
 * Returns -1 if no clear marker is found.
 */
function findBibliographyStart(paperText: string): number {
  const half = Math.floor(paperText.length / 2);
  const re = /\b(References|Bibliography|Works\s+Cited)\b/g;
  re.lastIndex = half;
  const match = re.exec(paperText);
  if (match) return match.index;
  // Fall back to first occurrence anywhere if the paper is short and the
  // bibliography is in the first half (rare — short standalone refs).
  re.lastIndex = 0;
  const fallback = re.exec(paperText);
  return fallback ? fallback.index : -1;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Return the page number at byte offset `pos` in the paper text, by
 * scanning for the most recent `[Page N]` marker before that offset.
 * Returns undefined if no page markers are present in the paper.
 */
function pageAt(paperText: string, pos: number): number | undefined {
  const before = paperText.slice(0, pos);
  let lastPage: number | undefined;
  PAGE_MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAGE_MARKER_RE.exec(before)) !== null) {
    lastPage = parseInt(m[1], 10);
  }
  return lastPage;
}

/**
 * Verbatim snippet of the paper text starting at `pos`, for locating the
 * match inside the rendered page's text layer. Cut at the next `[Page N]`
 * marker — the marker is an extraction artifact that never appears in the
 * rendered page, and text past it lives on a different page anyway.
 */
function anchorAt(paperText: string, pos: number, len = 60): string {
  const slice = paperText.slice(pos, pos + len);
  const cut = slice.search(/\[Page \d+\]/);
  return (cut >= 0 ? slice.slice(0, cut) : slice).trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function anchorCandidates(
  ...values: Array<string | string[] | undefined>
): string | string[] | undefined {
  const out: string[] = [];
  for (const value of values) {
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      const trimmed = candidate?.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  if (out.length === 0) return undefined;
  return out.length === 1 ? out[0] : out;
}
