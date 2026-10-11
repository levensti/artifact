/**
 * Section detection: turn a document's text into a heading tree with char
 * ranges, so chunking can run per section and every chunk carries the
 * section it belongs to.
 *
 * Sources, most reliable first:
 *   1. The PDF outline (bookmarks) the browser extracted with pdf.js —
 *      authoritative for textbooks and most published PDFs.
 *   2. Numbered headings found in the text ("3.2 Architecture"), accepted
 *      only when their numbers form a plausible sequence, since extracted
 *      text has no line breaks and "Table 3 Results" would otherwise match.
 *   3. Nothing: the whole document is one implicit section (returns []).
 *
 * Pure: no I/O. Offsets refer to the original text.
 */

import type { DocumentOutlineEntry } from "@/lib/documents";
import { pageAt, pageAtEnd, pageRange, parsePageMarkers, type PageMarker } from "./text";

export interface DetectedSection {
  title: string;
  label: string | null;
  depth: number;
  /** Index into the returned array of the parent section, or null. */
  parentIndex: number | null;
  /** Position among siblings. */
  ordinal: number;
  charStart: number;
  charEnd: number;
  startPage: number | null;
  endPage: number | null;
}

interface Candidate {
  title: string;
  label: string | null;
  depth: number;
  offset: number;
}

export function detectSections(
  text: string,
  outline?: DocumentOutlineEntry[] | null,
): DetectedSection[] {
  const markers = parsePageMarkers(text);
  let candidates: Candidate[] = [];
  if (outline && outline.length > 0) {
    candidates = fromOutline(text, markers, outline);
  }
  if (candidates.length < 2) {
    candidates = fromNumberedHeadings(text);
  }
  if (candidates.length < 2) return [];
  const sections = build(text, markers, candidates);
  positionalLabels(text, sections);
  return sections;
}

/* ------------------------------------------------------------------ */
/*  Source 1: PDF outline                                              */
/* ------------------------------------------------------------------ */

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Place each outline entry at a char offset: the start of its page, refined
 * to the position of its title text within that page when it can be found
 * (normalized match, so extraction artifacts like "Effi cient" still hit).
 */
function fromOutline(
  text: string,
  markers: PageMarker[],
  outline: DocumentOutlineEntry[],
): Candidate[] {
  const out: Candidate[] = [];
  for (const entry of outline) {
    const title = entry.title.trim();
    if (!title) continue;
    const range = pageRange(markers, entry.page, text.length);
    if (!range) continue;
    let offset = range.start;
    const needle = normalize(title).slice(0, 60);
    if (needle.length >= 4) {
      const pageText = text.slice(range.start, range.end);
      const hit = findNormalized(pageText, needle);
      if (hit >= 0) offset = range.start + hit;
    }
    const { label, rest } = splitLabel(title);
    out.push({ title: rest || title, label, depth: entry.depth, offset });
  }
  // Outline order is document order; enforce monotonic offsets so a
  // mis-resolved entry can't produce negative-length sections.
  const sorted = out.filter((c, i) => i === 0 || c.offset >= out[i - 1].offset);
  return sorted;
}

/** Index in `haystack` where the normalized `needle` starts, or -1. */
function findNormalized(haystack: string, needle: string): number {
  let norm = "";
  const owners: number[] = [];
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i].toLowerCase();
    if (/[a-z0-9]/.test(ch)) {
      norm += ch;
      owners.push(i);
    }
  }
  const idx = norm.indexOf(needle);
  return idx >= 0 ? owners[idx] : -1;
}

/* ------------------------------------------------------------------ */
/*  Source 2: numbered headings in the text                            */
/* ------------------------------------------------------------------ */

const HEADING_RE =
  /(?:^|\s)((?:[1-9]\d?|[A-H])(?:\.\d{1,2}){0,3})\.?\s+([A-Z][A-Za-z][^\s]{0,30}(?:\s+(?:[A-Za-z&\-:,]{1,30})){0,9})(?=\s)/g;

/**
 * Words that commonly follow a bare number without being a heading ("Table 3
 * shows", "Section 2 describes", "Figure 4"). Candidates whose title starts
 * with these are dropped.
 */
const NOT_HEADING_START = new Set([
  "shows", "show", "describes", "presents", "of", "in", "and", "the", "is",
  "are", "we", "for", "to", "with", "from", "on", "at", "as", "by",
]);

function fromNumberedHeadings(text: string): Candidate[] {
  const raw: Candidate[] = [];
  for (const m of text.matchAll(HEADING_RE)) {
    const label = m[1];
    const title = m[2].trim();
    const firstWord = title.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (NOT_HEADING_START.has(firstWord)) continue;
    // "Table 3" / "Figure 2" / "Section 4" immediately before the number.
    const before = text.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    if (/(?:table|figure|fig\.?|section|eq\.?|equation|chapter|ref\.?)\s*$/i.test(before)) {
      continue;
    }
    const offset = (m.index ?? 0) + (m[0].length - m[0].trimStart().length);
    raw.push({ title, label, depth: label.split(".").length - 1, offset });
  }
  return filterSequence(raw);
}

/**
 * Keep only candidates whose labels continue a plausible numbering walk:
 * next sibling (3 → 4, 3.2 → 3.3), first child (3 → 3.1), or a sibling of
 * any ancestor (3.2.4 → 4). The first accepted label must be a top-level 1
 * or A (appendices). Greedy single pass — good enough to reject the
 * "random numbers followed by capitalized words" noise of extracted text.
 */
function filterSequence(cands: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  let current: string[] | null = null;
  for (const c of cands) {
    const parts = c.label!.split(".");
    if (current === null) {
      if (parts.length === 1 && (parts[0] === "1" || parts[0] === "A")) {
        out.push(c);
        current = parts;
      }
      continue;
    }
    if (isNext(current, parts)) {
      out.push(c);
      current = parts;
    }
  }
  return out;
}

function succ(part: string): string | null {
  if (/^\d+$/.test(part)) return String(Number(part) + 1);
  if (/^[A-G]$/.test(part)) return String.fromCharCode(part.charCodeAt(0) + 1);
  return null;
}

function isNext(cur: string[], next: string[]): boolean {
  // First child.
  if (next.length === cur.length + 1) {
    return next.slice(0, cur.length).join(".") === cur.join(".") && next[next.length - 1] === "1";
  }
  // Appendix after the numbered body: "A" after "5" or "5.3".
  if (next.length === 1 && next[0] === "A" && /^\d+$/.test(cur[0])) return true;
  // Sibling of self or of an ancestor.
  if (next.length <= cur.length) {
    const prefix = cur.slice(0, next.length - 1);
    if (next.slice(0, -1).join(".") !== prefix.join(".")) return false;
    return next[next.length - 1] === succ(cur[next.length - 1]);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Tree construction                                                  */
/* ------------------------------------------------------------------ */

/**
 * Split a printed heading number off a title. Numeric components are at
 * most two digits ("2019 to 2022" is a year, not a label); a bare letter
 * counts only in appendix forms ("A.", "A.1", "Appendix A"), since "A Tiny
 * History" starts with an article.
 */
export function splitLabel(title: string): { label: string | null; rest: string } {
  const t = title.trim();
  const appendix = t.match(/^Appendix\s+([A-Z])(?:[.:]|\s+|$)\s*(.*)$/i);
  if (appendix) return { label: appendix[1].toUpperCase(), rest: appendix[2].trim() || t };
  const m = t.match(/^(\d{1,2}(?:\.\d{1,2})*|[A-Z](?:\.\d{1,2})+|[A-Z](?=\.))\.?\s+(.+)$/);
  if (!m) return { label: null, rest: t };
  return { label: m[1], rest: m[2].trim() };
}

/**
 * Outline entries often omit the printed numbers ("Introduction" rather than
 * "1 Introduction"). When no entry carries a label, derive labels from tree
 * position (chapter 2's third child is "2.3") and keep them only if the
 * document's own text confirms the scheme: most derived "label title" pairs
 * must appear in the printed table of contents or at the headings. A book
 * with unnumbered chapters fails the check and stays unlabeled.
 */
function positionalLabels(text: string, sections: DetectedSection[]): void {
  if (sections.length === 0 || sections.some((s) => s.label)) return;
  const labels: string[] = [];
  const childCount = new Map<number | null, number>();
  sections.forEach((s, i) => {
    const n = (childCount.get(s.parentIndex) ?? 0) + 1;
    childCount.set(s.parentIndex, n);
    labels[i] = s.parentIndex === null ? String(n) : `${labels[s.parentIndex]}.${n}`;
  });
  // Verify against the leading part of the text (where a ToC lives) plus
  // each heading's own neighborhood.
  const head = normalize(text.slice(0, 60_000));
  let hits = 0;
  let checked = 0;
  sections.forEach((s, i) => {
    const needle = normalize(`${labels[i]} ${s.title}`).slice(0, 48);
    if (needle.length < 6) return;
    checked++;
    const local = normalize(text.slice(Math.max(0, s.charStart - 40), s.charStart + s.title.length + 40));
    if (head.includes(needle) || local.includes(needle)) hits++;
  });
  if (checked === 0 || hits / checked < 0.6) return;
  sections.forEach((s, i) => {
    s.label = labels[i];
  });
}

function build(
  text: string,
  markers: PageMarker[],
  cands: Candidate[],
): DetectedSection[] {
  const out: DetectedSection[] = [];
  const stack: number[] = []; // indices into `out`
  const siblingCount = new Map<number | null, number>();
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const charEnd = i + 1 < cands.length ? cands[i + 1].offset : text.length;
    while (stack.length > 0 && out[stack[stack.length - 1]].depth >= c.depth) {
      stack.pop();
    }
    const parentIndex = stack.length > 0 ? stack[stack.length - 1] : null;
    const ordinal = siblingCount.get(parentIndex) ?? 0;
    siblingCount.set(parentIndex, ordinal + 1);
    out.push({
      title: c.title.slice(0, 200),
      label: c.label,
      depth: stack.length,
      parentIndex,
      ordinal,
      charStart: c.offset,
      charEnd,
      startPage: pageAt(markers, c.offset),
      endPage: pageAtEnd(text, markers, c.offset, charEnd),
    });
    stack.push(out.length - 1);
  }
  // A parent's range spans its children: extend charEnd/endPage upward.
  for (let i = out.length - 1; i >= 0; i--) {
    const p = out[i].parentIndex;
    if (p === null) continue;
    if (out[i].charEnd > out[p].charEnd) {
      out[p].charEnd = out[i].charEnd;
      out[p].endPage = out[i].endPage;
    }
  }
  return out;
}

/**
 * The leaf ranges chunking runs over: every section's own text excluding
 * the parts covered by its children. A parent heading followed directly by
 * a child heading yields an empty own-range, which is skipped.
 */
export function leafRanges(
  text: string,
  sections: DetectedSection[],
): Array<{ sectionIndex: number | null; charStart: number; charEnd: number }> {
  if (sections.length === 0) {
    return [{ sectionIndex: null, charStart: 0, charEnd: text.length }];
  }
  const ranges: Array<{ sectionIndex: number | null; charStart: number; charEnd: number }> = [];
  // Front matter before the first heading is unsectioned.
  if (sections[0].charStart > 0) {
    ranges.push({ sectionIndex: null, charStart: 0, charEnd: sections[0].charStart });
  }
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const firstChild = sections.find((c) => c.parentIndex === i);
    const ownEnd = firstChild ? firstChild.charStart : s.charEnd;
    if (ownEnd > s.charStart) {
      ranges.push({ sectionIndex: i, charStart: s.charStart, charEnd: ownEnd });
    }
  }
  return ranges;
}
