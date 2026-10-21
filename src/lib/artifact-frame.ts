/**
 * The artifact sandbox: builds the document an artifact page runs in.
 *
 * Artifacts are model-written HTML with inline style and script, so they run
 * in an iframe with `sandbox="allow-scripts"` only (an opaque origin: no
 * cookies, storage, or app DOM; no forms, popups, or top navigation) and a
 * CSP with no network access. What makes them look like the app is what's
 * injected around the model's markup, not limits on it:
 *   - the theme: the app's :root tokens, fonts, and the dx-* rules, copied
 *     from the live stylesheets so they never drift;
 *   - ARTIFACT_BASE_CSS: plain elements (buttons, inputs, sliders, tables)
 *     styled to match, plus a few style primitives;
 *   - the bridge (BRIDGE_SCRIPT): `window.artifact` for reader state, asking
 *     the assistant, and theme colors from script; paper-reference chips;
 *     auto-height; the "what changed" highlight.
 *
 * Paper references and $…$ math are prepared in the parent before the page
 * loads (prepareArtifactBody), since KaTeX and the citation matcher live here.
 */

import katex from "katex";
import { findCitations } from "@/lib/citation-transform";

/* ------------------------------------------------------------------ */
/*  Messages across the frame boundary                                 */
/* ------------------------------------------------------------------ */

/** Page → app. The app trusts none of it: every field is re-validated. */
export type FrameMessage =
  | { type: "resize"; height: number }
  | { type: "cite"; kind: string; value: string }
  | { type: "ask"; prompt: string }
  | { type: "state"; state: unknown }
  | { type: "scroll"; top: number }
  | { type: "error"; message: string };

/** App → page. */
export type HostMessage =
  | { type: "citations"; unresolved: string[]; tooltips: Record<string, string> }
  | { type: "highlight"; paths: number[][] };

/** Tag on every bridge message so stray postMessages are ignored. */
export const FRAME_CHANNEL = "artifact-frame";

/* ------------------------------------------------------------------ */
/*  Preparing the body                                                 */
/* ------------------------------------------------------------------ */

/** Text under these never becomes a chip or math. */
const NO_TRANSFORM = "script, style, code, pre, textarea, svg, summary, button, [data-no-cite]";

/** `$$…$$` display math, then `$…$` inline math (no space just inside the
 *  dollars and no digit right after the closing one, so "$5 and $10" stays
 *  text). */
const MATH_RE = /\$\$([\s\S]+?)\$\$|(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g;

function renderMath(tex: string, display: boolean): string {
  try {
    // MathML renders natively in the frame: no KaTeX CSS or fonts needed.
    return katex.renderToString(tex, {
      output: "mathml",
      displayMode: display,
      throwOnError: false,
    });
  } catch {
    return "";
  }
}

/**
 * Turn paper references (§3.2, Fig. 4, Table 2, Ref. [12]) in text into chip
 * buttons the bridge routes to the PDF, and $…$ math into MathML. Runs on a
 * parsed copy (DOMParser never runs scripts) and serializes the body back;
 * script and style text pass through untouched.
 */
export function prepareArtifactBody(html: string, parser?: DOMParser): string {
  const doc = (parser ?? new DOMParser()).parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    "text/html",
  );
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);

  for (const node of nodes) {
    if (node.parentElement?.closest(NO_TRANSFORM)) continue;
    const text = node.data;
    const pieces: Array<string | Node> = [];
    let at = 0;
    let changed = false;

    for (const m of text.matchAll(MATH_RE)) {
      const tex = m[1] ?? m[2];
      const rendered = tex ? renderMath(tex, m[1] !== undefined) : "";
      if (!rendered) continue;
      pieces.push(text.slice(at, m.index));
      const span = doc.createElement("span");
      span.className = "dx-math";
      span.innerHTML = rendered;
      pieces.push(span);
      at = m.index + m[0].length;
      changed = true;
    }
    pieces.push(text.slice(at));

    // Chips in the remaining text runs.
    const out: Node[] = [];
    for (const piece of pieces) {
      if (typeof piece !== "string") {
        out.push(piece);
        continue;
      }
      let pos = 0;
      for (const c of findCitations(piece)) {
        if (c.start > pos) out.push(doc.createTextNode(piece.slice(pos, c.start)));
        const chip = doc.createElement("button");
        chip.setAttribute("type", "button");
        chip.setAttribute("class", "citation-chip");
        chip.setAttribute("data-cite-kind", c.kind);
        chip.setAttribute("data-cite-value", c.value);
        chip.textContent = c.label;
        out.push(chip);
        pos = c.end;
        changed = true;
      }
      if (pos < piece.length) out.push(doc.createTextNode(piece.slice(pos)));
    }
    if (changed) node.replaceWith(...out);
  }
  return doc.body.innerHTML;
}

/* ------------------------------------------------------------------ */
/*  Theme, copied from the live app                                    */
/* ------------------------------------------------------------------ */

/** Rules worth carrying into the frame: tokens, fonts, and the dx-* kit. */
function wanted(rule: CSSRule): boolean {
  if (rule instanceof CSSFontFaceRule) return true;
  if (rule instanceof CSSStyleRule) {
    const sel = rule.selectorText;
    // Light theme only: the app has no dark mode.
    return sel === ":root" || /\bdx-|citation-chip/.test(sel);
  }
  return false;
}

function collectRules(rules: CSSRuleList, out: string[]): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      const inner: string[] = [];
      collectRules(rule.cssRules, inner);
      if (inner.length > 0) {
        const at = rule instanceof CSSMediaRule ? "@media" : "@supports";
        out.push(`${at} ${rule.conditionText} {\n${inner.join("\n")}\n}`);
      }
    } else if ("cssRules" in rule && !(rule instanceof CSSStyleRule)) {
      // @layer blocks and the like: flatten, order inside is kept.
      collectRules((rule as CSSGroupingRule).cssRules, out);
    } else if (wanted(rule)) {
      out.push(rule.cssText);
    }
  }
}

let themeCache: string | null = null;

/**
 * The app's theme as one stylesheet for the frame: :root tokens, @font-face
 * rules, the dx-* and citation-chip rules, and --font-sans / --font-mono
 * resolved to the loaded families. Cached; the theme doesn't change at
 * runtime.
 */
export function collectThemeCss(): string {
  if (themeCache !== null) return themeCache;
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      collectRules(sheet.cssRules, out);
    } catch {
      // Cross-origin sheet (none expected): nothing to copy.
    }
  }
  const root = getComputedStyle(document.documentElement);
  const family = (v: string) => root.getPropertyValue(v).trim();
  const sans = family("--font-geist-sans");
  const mono = family("--font-geist-mono");
  out.push(
    `:root {\n  --font-sans: ${sans ? `${sans}, ` : ""}ui-sans-serif, system-ui, sans-serif;\n  --font-mono: ${mono ? `${mono}, ` : ""}ui-monospace, "SF Mono", Menlo, monospace;\n}`,
  );
  themeCache = out.join("\n");
  return themeCache;
}

/* ------------------------------------------------------------------ */
/*  Base styles and primitives                                         */
/* ------------------------------------------------------------------ */

/**
 * Plain elements styled like the app, so a page that writes ordinary markup
 * already fits. Plus a few style primitives (not components): dx-card,
 * dx-controls, dx-muted, dx-correct / dx-incorrect, and pressed-button
 * styling for toggles and segmented choices.
 */
export const ARTIFACT_BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
body {
  color: var(--foreground);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}
#artifact-root { padding: 2px; }
[hidden] { display: none !important; }
img, svg, canvas, video { max-width: 100%; }
canvas { display: block; }
.dx-math math { font-size: 1.05em; }
.dx-math math[display="block"] { margin: var(--space-2) 0; }

button, input, select, textarea { font: inherit; color: inherit; }
button:not(.citation-chip) {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1-5);
  min-height: 28px;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}
button:not(.citation-chip):hover { background: var(--muted); }
button:not(.citation-chip):disabled { opacity: 0.5; cursor: default; }
button[aria-pressed="true"], button.dx-selected {
  border-color: color-mix(in srgb, var(--primary) 45%, transparent);
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  color: var(--primary);
}
button.dx-primary {
  border-color: transparent;
  background: var(--primary);
  color: var(--primary-foreground);
}
button.dx-primary:hover { background: color-mix(in srgb, var(--primary) 88%, var(--foreground)); }
input[type="text"], input[type="number"], input:not([type]), select, textarea {
  min-height: 28px;
  padding: 2px var(--space-2);
  border: 1px solid var(--input);
  border-radius: var(--radius);
  background: var(--background);
  font-size: 0.8125rem;
}
textarea { width: 100%; padding: var(--space-1-5) var(--space-2); line-height: 1.5; }
input[type="range"] { width: 100%; accent-color: var(--primary); }
input[type="checkbox"], input[type="radio"] { accent-color: var(--primary); }
label { font-size: 0.8125rem; }
output { font-variant-numeric: tabular-nums; font-weight: 600; }
:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ring) 45%, transparent);
  outline-offset: 1px;
}
.dx-artifact table { width: 100%; text-align: left; }
.dx-artifact th { font-weight: 600; background: var(--muted); }

.dx-card {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
}
.dx-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}
.dx-muted { color: var(--muted-foreground); font-size: 0.8125rem; }
.dx-correct {
  border-color: color-mix(in srgb, var(--success) 45%, transparent) !important;
  background: color-mix(in srgb, var(--success) 9%, transparent) !important;
}
.dx-incorrect {
  border-color: color-mix(in srgb, var(--destructive) 40%, transparent) !important;
  background: color-mix(in srgb, var(--destructive) 7%, transparent) !important;
}

/* "What changed": a soft wash that fades after an edit lands. */
.artifact-changed { animation: artifact-changed 2.4s var(--ease-out) both; border-radius: 6px; }
@keyframes artifact-changed {
  0%, 25% {
    background-color: color-mix(in srgb, var(--primary) 10%, transparent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 10%, transparent);
  }
  100% { background-color: transparent; box-shadow: 0 0 0 4px transparent; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
`;

/* ------------------------------------------------------------------ */
/*  The bridge                                                         */
/* ------------------------------------------------------------------ */

/**
 * Runs first in the frame. Everything it sends is validated by the host;
 * `ask` only prefills the composer (a click inside the frame can't be
 * verified as the user's), and state saves are size-capped server-side.
 */
const BRIDGE_SCRIPT = `
(function () {
  var CHANNEL = ${JSON.stringify(FRAME_CHANNEL)};
  var boot = JSON.parse(document.getElementById("artifact-boot").textContent);
  var state = boot.state;
  function post(msg) {
    msg.channel = CHANNEL;
    parent.postMessage(msg, "*");
  }
  window.artifact = Object.freeze({
    getState: function () { return state === undefined ? null : JSON.parse(JSON.stringify(state)); },
    setState: function (next) {
      state = next === undefined ? null : JSON.parse(JSON.stringify(next));
      post({ type: "state", state: state });
    },
    ask: function (prompt) { post({ type: "ask", prompt: String(prompt).slice(0, 2000) }); },
    color: function (token) {
      return getComputedStyle(document.documentElement)
        .getPropertyValue("--" + String(token).replace(/^--/, "")).trim();
    },
  });

  document.addEventListener("click", function (e) {
    var el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    var chip = el.closest("[data-cite-kind]");
    if (chip) {
      e.preventDefault();
      post({ type: "cite", kind: chip.getAttribute("data-cite-kind"), value: chip.getAttribute("data-cite-value") || "" });
      return;
    }
    var ask = el.closest("[data-ask]");
    if (ask) {
      e.preventDefault();
      window.artifact.ask(ask.getAttribute("data-ask") || ask.textContent || "");
    }
  });

  var lastHeight = 0;
  function measure() {
    var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (h !== lastHeight) { lastHeight = h; post({ type: "resize", height: h }); }
  }
  new ResizeObserver(measure).observe(document.documentElement);
  window.addEventListener("load", measure);

  window.addEventListener("error", function (e) {
    post({ type: "error", message: String(e.message || "Script error").slice(0, 300) });
  });

  function nodeAt(path) {
    var node = document.getElementById("artifact-root");
    for (var i = 0; node && i < path.length; i++) node = node.children[path[i]];
    return node;
  }
  window.addEventListener("message", function (e) {
    if (e.source !== parent || !e.data || e.data.channel !== CHANNEL) return;
    var msg = e.data;
    if (msg.type === "citations") {
      document.querySelectorAll("[data-cite-kind]").forEach(function (chip) {
        var key = chip.getAttribute("data-cite-kind") + ":" + chip.getAttribute("data-cite-value");
        chip.classList.toggle("citation-chip--unresolved", msg.unresolved.indexOf(key) >= 0);
        if (msg.tooltips[key]) chip.setAttribute("title", msg.tooltips[key]);
      });
    } else if (msg.type === "highlight") {
      var first = null;
      msg.paths.forEach(function (path) {
        var node = nodeAt(path);
        if (!node || !node.classList) return;
        node.classList.remove("artifact-changed");
        void node.offsetWidth;
        node.classList.add("artifact-changed");
        if (!first) first = node;
      });
      if (first) post({ type: "scroll", top: first.getBoundingClientRect().top + window.scrollY });
    }
  });
})();
`;

/* ------------------------------------------------------------------ */
/*  The document                                                       */
/* ------------------------------------------------------------------ */

/** No network at all: inline script and style only, data: images and
 *  fonts, and the app's own font files. */
function contentSecurityPolicy(fontOrigin: string): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    `font-src data: ${fontOrigin}`,
    "media-src data: blob:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** JSON safe to embed in a <script type="application/json"> element. */
function embedJson(value: unknown): string {
  return JSON.stringify(value ?? null).replace(/</g, "\\u003c");
}

export function buildArtifactDocument(params: {
  /** Prepared body (prepareArtifactBody). */
  body: string;
  themeCss: string;
  /** Saved reader state, handed to the page as artifact.getState(). */
  state: unknown;
  fontOrigin: string;
}): string {
  const { body, themeCss, state, fontOrigin } = params;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(fontOrigin)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${themeCss}</style>
<style>${ARTIFACT_BASE_CSS}</style>
<script type="application/json" id="artifact-boot">${embedJson({ state })}</script>
<script>${BRIDGE_SCRIPT}</script>
</head>
<body>
<div id="artifact-root" class="dx-diagram dx-artifact">
${body}
</div>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  What changed between two versions                                  */
/* ------------------------------------------------------------------ */

/**
 * Element paths (child indexes from the page root) that are new or changed
 * in `next` compared with `prev`. Descends while exactly one element differs
 * at a level, so a one-line edit deep in a section highlights that line, not
 * the whole section. Script and style elements never count.
 */
export function changedPaths(prev: string, next: string, parser?: DOMParser): number[][] {
  const p = parser ?? new DOMParser();
  const parse = (html: string) =>
    p.parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html").body;
  const visible = (el: Element) => !/^(SCRIPT|STYLE)$/.test(el.tagName);

  function diff(a: Element, b: Element, path: number[]): number[][] {
    const before = new Set(Array.from(a.children).filter(visible).map((c) => c.outerHTML));
    const changed: number[] = [];
    Array.from(b.children).forEach((child, i) => {
      if (visible(child) && !before.has(child.outerHTML)) changed.push(i);
    });
    if (changed.length === 0) return [];
    const aKids = Array.from(a.children);
    const bKids = Array.from(b.children);
    if (changed.length === 1 && aKids.length === bKids.length) {
      const i = changed[0];
      const twin = aKids[i];
      if (twin && twin.tagName === bKids[i].tagName && bKids[i].children.length > 0) {
        const inner = diff(twin, bKids[i], [...path, i]);
        if (inner.length > 0) return inner;
      }
    }
    return changed.map((i) => [...path, i]);
  }

  return diff(parse(prev), parse(next), []);
}
