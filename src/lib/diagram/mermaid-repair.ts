/**
 * Best-effort deterministic repair for the common ways models break Mermaid.
 *
 * Only ever applied AFTER the original source fails to parse, so a valid
 * diagram is never altered — at worst the repaired version also fails and
 * the renderer falls back to its failure card.
 *
 * Each pass is a pure, idempotent `(src) => src` transform, exported
 * individually for unit tests and composed in order by `repairMermaid`.
 */

/**
 * Quote node labels containing risky characters, e.g. `A[Encoder (repeated)]`
 * — Mermaid reads the `(` as a shape token and throws.
 *
 * Each rule requires a word char before the opening delimiter (so we target
 * node definitions `id[...]`, not edge text); compound shapes are matched
 * first, and the single-delimiter rules guard against doubled delimiters so
 * they can't bite into a compound shape.
 */
const LABEL_RULES: Array<[RegExp, string, string]> = [
  [/(?<=\w)\[\[([^"\n]*?)\]\]/g, "[[", "]]"],
  [/(?<=\w)\{\{([^"\n]*?)\}\}/g, "{{", "}}"],
  [/(?<=\w)\[\(([^"\n]*?)\)\]/g, "[(", ")]"],
  [/(?<=\w)\(\[([^"\n]*?)\]\)/g, "([", "])"],
  [/(?<=\w)\(\(([^"\n]*?)\)\)/g, "((", "))"],
  [/(?<=\w)\[(?![[(])([^"[\]\n]*?)\]/g, "[", "]"],
  [/(?<=\w)\((?![([])([^"()\n]*?)\)/g, "(", ")"],
  [/(?<=\w)\{(?!\{)([^"{}\n]*?)\}/g, "{", "}"],
];
const RISKY_LABEL = /[()[\]{}/<>:;]/;

export function quoteUnsafeLabels(src: string): string {
  let out = src;
  for (const [re, open, close] of LABEL_RULES) {
    out = out.replace(re, (m, inner: string) =>
      RISKY_LABEL.test(inner)
        ? `${open}"${inner.replace(/"/g, "&quot;")}"${close}`
        : m,
    );
  }
  return out;
}

/**
 * Legacy xychart-beta rescue: strip any trailing text after a `bar [...]` /
 * `line [...]` array (models add series labels / colors there, which the
 * grammar rejects). Only a SINGLE-series chart is rescued — multiple bar/line
 * series can't be legended in xychart-beta, so we don't strip-and-render them
 * into a misleading legend-less overlay. xychart is no longer taught (the
 * native ```chart fence replaced it); this pass survives for old messages.
 */
export function stripXychartTrailing(src: string): string {
  if (!/^\s*xychart/i.test(src)) return src;
  const seriesCount = (src.match(/^\s*(?:bar|line)\s*\[/gim) ?? []).length;
  if (seriesCount !== 1) return src;
  return src.replace(/^(\s*(?:bar|line)\s*\[[^\]\n]*\]).*$/gim, "$1");
}

const PASSES: Array<(src: string) => string> = [
  quoteUnsafeLabels,
  stripXychartTrailing,
];

/** Run every repair pass once, in order. */
export function repairMermaid(src: string): string {
  return PASSES.reduce((out, pass) => pass(out), src);
}
