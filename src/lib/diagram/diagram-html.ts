/**
 * Sanitizer for the ```diagram fence: the model draws with HTML and inline
 * SVG, and this module is the security and theme boundary.
 *
 * The policy is "unbounded structure, bounded palette": layout tags, tables,
 * SVG shapes, and inline styles all pass, so the model can compose arbitrary
 * visualizations, but
 *   - scripts, event handlers, URLs, images, and links are stripped,
 *   - style is filtered to an allowlist of layout/sizing/typography
 *     properties (no position, no z-index, no fonts),
 *   - every color (CSS or SVG fill/stroke) must be a theme value: var(--*),
 *     color-mix over them, or a keyword. Raw hex/rgb/hsl colors are dropped
 *     ON PURPOSE so diagrams stay on the app palette (and restyle with it,
 *     since persisted output stores token names, not literal colors),
 *   - class tokens are restricted to the dx-* namespace (the design-system
 *     building blocks in globals.css), so markup can't reach app styles.
 *
 * Runs on a dedicated DOMPurify instance so the hooks here never leak into
 * other sanitize call sites (web-viewer uses the shared default instance).
 * Takes an explicit window in tests (vitest runs in a node environment, so
 * the suite passes a jsdom window); in the browser the global window is used
 * and the configured instance is cached.
 */
import DOMPurify, { type WindowLike } from "dompurify";

const ALLOWED_TAGS = [
  // structure + text
  "div",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "br",
  // compact grids/matrices
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  // freeform drawing
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
];

/** SVG geometry/presentation attributes (always lowercase for matching;
 *  DOMPurify preserves the original casing, e.g. viewBox, in the output). */
const SVG_ATTRS = [
  "viewbox",
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "width",
  "height",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "text-anchor",
  "dominant-baseline",
  "font-size",
  "font-weight",
  "transform",
];

const ALLOWED_ATTR = ["class", "style", ...SVG_ATTRS];

/** Inline-style properties the model may set: layout, sizing, borders,
 *  typography scale, and SVG paint. Notably absent: position, inset,
 *  z-index, font-family, content, filter, animation. */
const STYLE_PROPS = new Set([
  "display",
  "flex",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "align-self",
  "align-content",
  "justify-content",
  "justify-items",
  "justify-self",
  "gap",
  "row-gap",
  "column-gap",
  "order",
  "grid-template-columns",
  "grid-template-rows",
  "grid-auto-flow",
  "grid-auto-rows",
  "grid-column",
  "grid-row",
  "place-items",
  "place-content",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "aspect-ratio",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-width",
  "border-style",
  "border-color",
  "border-radius",
  "border-collapse",
  "border-spacing",
  "background",
  "background-color",
  "color",
  "opacity",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant-numeric",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "white-space",
  "overflow-wrap",
  "vertical-align",
  "overflow",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "transform",
  "transform-origin",
]);

/**
 * One value rule for every style declaration and SVG attribute: conservative
 * charset (no quotes, semicolons, '#', '!', ':', backslashes), explicit bans
 * on URL-ish constructs and raw color functions, and a length cap. Banning
 * '#'/rgb()/hsl() is what enforces the theme-variable-only palette; var()
 * and color-mix() pass the charset naturally.
 */
const VALUE_CHARSET = /^[a-z0-9\s,.%/()*+-]*$/i;
const VALUE_BANNED =
  /url|expression|image|element|attr|counter|javascript|\brgba?\(|\bhsla?\(/i;

function safeValue(value: string): boolean {
  const v = value.trim();
  return (
    v.length > 0 &&
    v.length <= 160 &&
    VALUE_CHARSET.test(v) &&
    !VALUE_BANNED.test(v)
  );
}

/** Filter a style attribute to allowlisted properties with safe values.
 *  Returns null when nothing survives. */
function sanitizeStyle(style: string): string | null {
  const kept: string[] = [];
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const prop = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (STYLE_PROPS.has(prop) && safeValue(value)) {
      kept.push(`${prop}: ${value}`);
    }
  }
  return kept.length > 0 ? kept.join("; ") : null;
}

/** Class tokens are namespaced: only dx-* (the design-system blocks) pass,
 *  so generated markup can't reach app or tailwind styles. */
const CLASS_TOKEN = /^dx-[\w-]+$/;

export interface SanitizedDiagram {
  /** Safe HTML, ready for dangerouslySetInnerHTML. */
  html: string;
  /** Text of the first dx-title element, for the lightbox dialog title. */
  title: string | null;
  /** True when nothing visible survived sanitization (render the fallback). */
  empty: boolean;
}

function createPurify(win: WindowLike) {
  const purify = DOMPurify(win);
  purify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    if (typeof el.getAttribute !== "function") return;
    // Snapshot first: removing while iterating mutates the live collection.
    for (const { name, value } of Array.from(el.attributes)) {
      if (name === "class") {
        const kept = value.split(/\s+/).filter((t) => CLASS_TOKEN.test(t));
        if (kept.length > 0) el.setAttribute("class", kept.join(" "));
        else el.removeAttribute("class");
      } else if (name === "style") {
        const kept = sanitizeStyle(value);
        if (kept) el.setAttribute("style", kept);
        else el.removeAttribute("style");
      } else if (!safeValue(value)) {
        // SVG attribute (the only others DOMPurify lets through) with an
        // out-of-policy value, e.g. fill="#888".
        el.removeAttribute(name);
      }
    }
  });
  return purify;
}

let browserPurify: ReturnType<typeof createPurify> | null = null;

export function sanitizeDiagramHtml(
  source: string,
  win?: WindowLike,
): SanitizedDiagram {
  const w =
    win ??
    (typeof window !== "undefined" ? (window as unknown as WindowLike) : null);
  // No DOM (SSR pass): report empty; the client render does the real work.
  if (!w) return { html: "", title: null, empty: true };
  const purify = win ? createPurify(win) : (browserPurify ??= createPurify(w));

  const fragment = purify.sanitize(source, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    RETURN_DOM_FRAGMENT: true,
  });
  const container = fragment.ownerDocument.createElement("div");
  container.appendChild(fragment);

  const text = (container.textContent ?? "").trim();
  const title = container.querySelector(".dx-title")?.textContent?.trim();
  // A pure-SVG diagram can be meaningful with no text at all.
  const empty = !text && container.querySelector("svg") === null;
  return { html: container.innerHTML, title: title || null, empty };
}
