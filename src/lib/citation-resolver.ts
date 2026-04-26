/**
 * Resolve citation tokens (§N, Fig. N, Ref. [key]) to a page number and
 * tooltip text using the paper's extracted text and (when available) its
 * structured representation.
 *
 * The extracted text from `pdfjs-dist` is annotated with `[Page N]` markers
 * at every page boundary; we use those as the ground truth for "what page
 * does this thing live on?" The structured paper is consulted first when
 * present, but we always fall back to scanning the raw text — the model
 * doesn't reliably populate `startPage`, and short papers skip parsing
 * entirely.
 */

import type {
  ParsedFigure,
  ParsedPaper,
  ParsedReference,
  ParsedSection,
} from "@/lib/review-types";

export interface CitationResolution {
  page?: number;
  tooltip?: string;
}

const PAGE_MARKER_RE = /\[Page (\d+)\]/g;

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function resolveSection(
  sectionNum: string,
  parsed: ParsedPaper | null,
  paperText: string | null | undefined,
): CitationResolution {
  if (parsed) {
    const match = findSectionInParsed(parsed.sections, sectionNum);
    if (match) {
      const fromText = paperText
        ? findSectionInText(paperText, sectionNum, match.heading)
        : null;
      return {
        page: match.startPage ?? fromText?.page,
        tooltip: match.heading,
      };
    }
  }
  if (paperText) {
    return findSectionInText(paperText, sectionNum) ?? {};
  }
  return {};
}

export function resolveFigure(
  figureNum: string,
  parsed: ParsedPaper | null,
  paperText: string | null | undefined,
): CitationResolution {
  if (parsed) {
    const match = findFigureInParsed(parsed.figures, figureNum);
    if (match) {
      const fromText = paperText
        ? findFigureInText(paperText, figureNum)
        : null;
      return {
        page: match.page ?? fromText?.page,
        tooltip: shorten(match.caption, 200),
      };
    }
  }
  if (paperText) {
    return findFigureInText(paperText, figureNum) ?? {};
  }
  return {};
}

export function resolveReference(
  key: string,
  parsed: ParsedPaper | null,
  paperText: string | null | undefined,
): CitationResolution {
  if (parsed) {
    const match = findReferenceInParsed(parsed.references, key);
    if (match) return { tooltip: shorten(match.text, 250) };
  }
  if (paperText) {
    return findReferenceInText(paperText, key) ?? {};
  }
  return {};
}

/* ------------------------------------------------------------------ */
/*  Parsed-paper lookups                                               */
/* ------------------------------------------------------------------ */

function sectionHeadingMatchesNumber(heading: string, num: string): boolean {
  const trimmed = heading.trim();
  return (
    trimmed.startsWith(`${num} `) ||
    trimmed.startsWith(`${num}.`) ||
    trimmed.startsWith(`${num}:`) ||
    trimmed === num
  );
}

function findSectionInParsed(
  sections: ParsedSection[],
  num: string,
): ParsedSection | null {
  return (
    sections.find((s) => sectionHeadingMatchesNumber(s.heading, num)) ?? null
  );
}

function findFigureInParsed(
  figures: ParsedFigure[],
  num: string,
): ParsedFigure | null {
  return (
    figures.find((f) => {
      const id = f.id.replace(/[^0-9.]/g, "");
      return id === num || f.id === num || f.id === `Figure ${num}`;
    }) ?? null
  );
}

function findReferenceInParsed(
  references: ParsedReference[],
  key: string,
): ParsedReference | null {
  const needle = normalizeKey(key);
  let match = references.find((r) => normalizeKey(r.key) === needle);
  if (!match) {
    match = references.find((r) => normalizeKey(r.key).includes(needle));
  }
  if (!match) {
    match = references.find((r) => r.text.toLowerCase().includes(key.toLowerCase()));
  }
  return match ?? null;
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
      return { page: pageAt(paperText, idx), tooltip: knownHeading };
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
): CitationResolution | null {
  // Match "Figure 3:" / "Fig. 3:" / "Figure 3." typically used for captions
  // (not in-text references). The colon/period after the number is a strong
  // caption signal — distinguishes from "Figure 3 shows…" mentions.
  const escNum = escapeRegex(num);
  const re = new RegExp(
    `(?:^|\\n|\\s)(?:Fig(?:ure)?\\.?\\s+)${escNum}[\\s.:](.{10,400})`,
    "i",
  );
  const match = re.exec(paperText);
  if (!match) {
    // Last resort: any "Figure N" mention.
    const fallbackRe = new RegExp(`(?:Fig(?:ure)?\\.?\\s+)${escNum}\\b`, "i");
    const fallback = fallbackRe.exec(paperText);
    if (fallback) {
      return { page: pageAt(paperText, fallback.index) };
    }
    return null;
  }

  const caption = `Figure ${num}: ${match[1].trim().split(/(?<=[.])\s/)[0]}`;
  return { page: pageAt(paperText, match.index), tooltip: shorten(caption, 200) };
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
