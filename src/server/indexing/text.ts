/**
 * Text utilities for the indexing pipeline: page-marker parsing and sentence
 * splitting with char offsets preserved. Pure functions, no I/O.
 *
 * Extracted text arrives as one `[Page N]` marker per page followed by that
 * page's text (see pdf-viewer.tsx). Offsets everywhere in the pipeline refer
 * to the ORIGINAL text so sections, chunks, and pages all line up.
 */

export interface PageMarker {
  /** Offset of the marker's first char in the text. */
  offset: number;
  page: number;
}

const PAGE_MARKER_RE = /\[Page (\d+)\]\n?/g;

export function parsePageMarkers(text: string): PageMarker[] {
  const out: PageMarker[] = [];
  for (const m of text.matchAll(PAGE_MARKER_RE)) {
    out.push({ offset: m.index ?? 0, page: Number(m[1]) });
  }
  return out;
}

/** 1-based page containing `offset`, or null when the text has no markers. */
export function pageAt(markers: PageMarker[], offset: number): number | null {
  if (markers.length === 0) return null;
  // Binary search for the last marker at or before `offset`.
  let lo = 0;
  let hi = markers.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (markers[mid].offset <= offset) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? markers[best].page : markers[0].page;
}

/**
 * Page of the last content char in [start, end). A range that ends right
 * after a page marker (the next section's heading sits at the top of the
 * following page) still belongs to the page before the marker.
 */
export function pageAtEnd(
  text: string,
  markers: PageMarker[],
  start: number,
  end: number,
): number | null {
  if (markers.length === 0) return null;
  let e = end;
  while (e > start && /\s/.test(text[e - 1])) e--;
  const tail = text.slice(Math.max(start, e - 12), e);
  const m = tail.match(/\[Page \d+\]$/);
  if (m) e -= m[0].length;
  while (e > start && /\s/.test(text[e - 1])) e--;
  return pageAt(markers, Math.max(start, e - 1));
}

/** Char range [start, end) of a 1-based page, or null if absent. */
export function pageRange(
  markers: PageMarker[],
  page: number,
  textLength: number,
): { start: number; end: number } | null {
  const idx = markers.findIndex((m) => m.page === page);
  if (idx === -1) return null;
  const start = markers[idx].offset;
  const end = idx + 1 < markers.length ? markers[idx + 1].offset : textLength;
  return { start, end };
}

export interface Sentence {
  text: string;
  /** Offsets into the original text. */
  start: number;
  end: number;
}

/**
 * Split `text[start, end)` into sentences. Boundaries are sentence-ending
 * punctuation followed by whitespace and a plausible sentence start, plus
 * blank lines. Page markers are stripped from sentence text. Over-long
 * runs with no punctuation (tables, code, reference lists) are hard-split so
 * a single "sentence" can never dominate a chunk.
 */
export function splitSentences(
  text: string,
  start = 0,
  end = text.length,
): Sentence[] {
  const MAX_SENTENCE_CHARS = 800;
  const out: Sentence[] = [];
  const push = (s: number, e: number) => {
    // Trim whitespace while keeping offsets honest.
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e <= s) return;
    const raw = text.slice(s, e);
    const cleaned = raw.replace(PAGE_MARKER_RE, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    out.push({ text: cleaned, start: s, end: e });
  };

  // Candidate boundaries: ". " / "? " / "! " followed by an uppercase letter,
  // digit, opening bracket or quote; or a blank line.
  const boundary = /(?<=[.?!]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])|\n\s*\n/g;
  boundary.lastIndex = start;
  let cursor = start;
  const region = text.slice(0, end);
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(region)) !== null) {
    const at = m.index;
    if (at <= cursor) continue;
    hardSplit(cursor, at);
    cursor = at + m[0].length;
  }
  hardSplit(cursor, end);
  return out;

  function hardSplit(s: number, e: number) {
    if (e - s <= MAX_SENTENCE_CHARS) {
      push(s, e);
      return;
    }
    // Split at the last whitespace before the cap, repeatedly.
    let cur = s;
    while (e - cur > MAX_SENTENCE_CHARS) {
      let cut = text.lastIndexOf(" ", cur + MAX_SENTENCE_CHARS);
      if (cut <= cur) cut = cur + MAX_SENTENCE_CHARS;
      push(cur, cut);
      cur = cut;
    }
    push(cur, e);
  }
}

/** Same estimate the transcript budgeting uses (chars / 4). */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
