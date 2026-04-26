/**
 * Transforms citation tokens emitted by the chat agent into markdown links
 * that the markdown renderer can recognize and render as styled chips.
 *
 * The agent is instructed to write citations like:
 *   - "§3" / "§3.2" / "Section 3" / "Sec. 3.2"          — section reference
 *   - "Fig. 3" / "Figure 3"                              — figure reference
 *   - "Ref. [27]" / "Ref. [Vaswani2017]"                 — bibliographic reference
 *
 * Surrounding parens are optional — bare inline forms like "see §4.2"
 * are matched too, since models drift away from a strict (§...) format.
 *
 * After transformation, the markdown renderer's `a` component looks for
 * links whose href begins with one of the prefixes below and renders them
 * as `CitationChip` instead of plain anchors.
 */

export const CITATION_PREFIX_SECTION = "#cite-section-";
export const CITATION_PREFIX_FIGURE = "#cite-figure-";
export const CITATION_PREFIX_REF = "#cite-ref-";

// §3, §3.2, § 3.2, Section 3, Sec. 3.2 — bare or parenthesized.
const SECTION_RE =
  /(?:§\s*|\bSection\s+|\bSec\.\s+)(\d+(?:\.\d+){0,2})\b/g;
// Fig. 3, Figure 3, Fig 3 — bare or parenthesized.
const FIGURE_RE = /\b(?:Fig\.?|Figure)\s+(\d+(?:\.\d+)?)\b/g;
// Ref. [27], Ref [27], Ref. [Vaswani2017], Ref [Vaswani et al., 2017]
const REF_RE = /\bRef\.?\s+\[([^\]]+)\]/g;

/**
 * Convert citation tokens in `content` into markdown links pointing at
 * synthetic anchors. The renderer's link handler resolves these to
 * `CitationChip` components.
 */
export function transformCitations(content: string): string {
  return content
    .replace(
      SECTION_RE,
      (_m, num: string) =>
        `[§${num}](${CITATION_PREFIX_SECTION}${encodeURIComponent(num)})`,
    )
    .replace(
      FIGURE_RE,
      (_m, num: string) =>
        `[Fig. ${num}](${CITATION_PREFIX_FIGURE}${encodeURIComponent(num)})`,
    )
    .replace(
      REF_RE,
      (_m, key: string) =>
        `[Ref. [${key}]](${CITATION_PREFIX_REF}${encodeURIComponent(key)})`,
    );
}

export type CitationKind = "section" | "figure" | "ref";

export interface CitationLinkInfo {
  kind: CitationKind;
  /** The captured value: section number, figure number, or reference key. */
  value: string;
}

/** Identify a citation href emitted by `transformCitations`. Returns null otherwise. */
export function citationFromHref(
  href: string | null | undefined,
): CitationLinkInfo | null {
  if (!href) return null;
  if (href.startsWith(CITATION_PREFIX_SECTION)) {
    return {
      kind: "section",
      value: safeDecode(href.slice(CITATION_PREFIX_SECTION.length)),
    };
  }
  if (href.startsWith(CITATION_PREFIX_FIGURE)) {
    return {
      kind: "figure",
      value: safeDecode(href.slice(CITATION_PREFIX_FIGURE.length)),
    };
  }
  if (href.startsWith(CITATION_PREFIX_REF)) {
    return {
      kind: "ref",
      value: safeDecode(href.slice(CITATION_PREFIX_REF.length)),
    };
  }
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
