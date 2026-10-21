/**
 * Lint for artifact page source, run when create/update_artifact saves it.
 *
 * The sandbox (see artifact-frame.ts) is the security boundary; this is the
 * consistency boundary, plus an early, explainable "no" for things the
 * sandbox would silently break:
 *   - errors reject the save with a message the model can act on: network
 *     access, external URLs, forms, nested frames, navigation, storage;
 *   - style fixes are applied in place: every raw color in markup or CSS
 *     (style attributes, <style> blocks, SVG paint attributes) is mapped to
 *     the nearest theme token, and font-family becomes the app's sans or mono
 *     stack. Script bodies are left alone; scripts read theme colors with
 *     artifact.color("chart-1").
 *
 * String-based on purpose: re-serializing through a DOM would risk changing
 * script text, and only declaration values are ever rewritten.
 */

/* ------------------------------------------------------------------ */
/*  Theme palette (light theme values from :root in globals.css)       */
/* ------------------------------------------------------------------ */

const PALETTE: Array<[token: string, hex: string]> = [
  ["background", "#ffffff"],
  ["foreground", "#1c1b19"],
  ["muted", "#f3f2ef"],
  ["secondary", "#f1f1ef"],
  ["border", "#e7e5e1"],
  ["muted-foreground", "#6f6c66"],
  ["primary", "#1e2b5e"],
  ["chart-2", "#7d90d9"],
  ["chart-3", "#3a6ea5"],
  ["chart-4", "#5e6a93"],
  ["chart-5", "#9db4d0"],
  ["destructive", "#dc2626"],
  ["success", "#3d7a47"],
  ["warning", "#b25a2a"],
];

const PALETTE_RGB = PALETTE.map(
  ([token, hex]) => [token, hexToRgb(hex)!] as const,
);

/** Common color names models reach for, mapped straight to a token. */
const NAMED: Record<string, string> = {
  black: "foreground",
  white: "background",
  gray: "muted-foreground",
  grey: "muted-foreground",
  lightgray: "border",
  lightgrey: "border",
  silver: "border",
  red: "destructive",
  crimson: "destructive",
  green: "success",
  orange: "warning",
  blue: "chart-3",
  navy: "primary",
  steelblue: "chart-3",
  purple: "chart-4",
  teal: "chart-3",
};

type Rgba = { r: number; g: number; b: number; a: number };

function hexToRgb(hex: string): Rgba | null {
  let h = hex.replace(/^#/, "");
  if (h.length === 3 || h.length === 4) {
    h = [...h].map((c) => c + c).join("");
  }
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Parse rgb()/rgba()/hsl()/hsla() in comma or space syntax. */
function funcToRgb(fn: string, args: string): Rgba | null {
  const parts = args
    .split(/[\s,/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  const alpha = (p: string | undefined) =>
    p === undefined ? 1 : p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p);
  if (fn.startsWith("rgb")) {
    const c = (p: string) =>
      p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p);
    const [r, g, b] = parts.slice(0, 3).map(c);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b, a: alpha(parts[3]) };
  }
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  if ([h, s, l].some(Number.isNaN)) return null;
  const [r, g, b] = hslToRgb(h, s, l);
  return { r, g, b, a: alpha(parts[3]) };
}

function nearestToken({ r, g, b }: Rgba): string {
  let best = PALETTE_RGB[0][0];
  let bestDist = Infinity;
  for (const [token, c] of PALETTE_RGB) {
    // Weighted RGB distance: close enough to perceptual for snapping.
    const d = 2 * (r - c.r) ** 2 + 4 * (g - c.g) ** 2 + 3 * (b - c.b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = token;
    }
  }
  return best;
}

function tokenColor(token: string, alpha: number): string {
  if (alpha >= 0.995) return `var(--${token})`;
  const pct = Math.max(0, Math.round(alpha * 100));
  return `color-mix(in srgb, var(--${token}) ${pct}%, transparent)`;
}

/* ------------------------------------------------------------------ */
/*  Value rewriting                                                    */
/* ------------------------------------------------------------------ */

const HEX_RE = /(?<![\w-])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const FUNC_RE = /\b(rgba?|hsla?)\(([^()]*)\)/gi;

/** Rewrite raw colors in one CSS value. Returns the value and how many
 *  colors it mapped. `url(#id)` references are left alone. */
function fixColorValue(value: string, prop?: string): [string, number] {
  let count = 0;
  let out = value
    .replace(FUNC_RE, (whole, fn: string, args: string) => {
      const rgba = funcToRgb(fn.toLowerCase(), args);
      if (!rgba) return whole;
      count++;
      return tokenColor(nearestToken(rgba), rgba.a);
    })
    .replace(HEX_RE, (whole, _hex: string, offset: number, all: string) => {
      if (/url\(\s*$/i.test(all.slice(0, offset))) return whole;
      const rgba = hexToRgb(whole);
      if (!rgba) return whole;
      count++;
      return tokenColor(nearestToken(rgba), rgba.a);
    });
  // A bare color name, only where the whole value (or a border shorthand's
  // last word) is a color.
  if (prop === undefined || /color|background|fill|stroke|border|outline/i.test(prop)) {
    out = out.replace(/(^|\s)([a-z]+)\s*$/i, (whole, lead: string, word: string) => {
      const token = NAMED[word.toLowerCase()];
      if (!token) return whole;
      count++;
      return `${lead}var(--${token})`;
    });
  }
  return [out, count];
}

/** Rewrite every declaration in a block of declarations (`a: b; c: d`). */
function fixDeclarations(css: string): [string, number] {
  let count = 0;
  const out = css.replace(
    /([\w-]+)(\s*:\s*)([^;{}]+)/g,
    (whole, prop: string, sep: string, value: string) => {
      const p = prop.toLowerCase();
      if (p.startsWith("--")) return whole;
      if (p === "font-family") {
        count++;
        const stack = /mono|courier|consolas|menlo/i.test(value)
          ? "var(--font-mono)"
          : "var(--font-sans)";
        return `${prop}${sep}${stack}`;
      }
      const [fixed, n] = fixColorValue(value, p);
      count += n;
      return `${prop}${sep}${fixed}`;
    },
  );
  return [out, count];
}

/** Rewrite declaration bodies in a stylesheet; selectors (which can look
 *  like hex colors, e.g. `#fab`) are never touched. */
function fixStylesheet(css: string): [string, number] {
  let count = 0;
  const out = css.replace(/\{([^{}]*)\}/g, (_whole, body: string) => {
    const [fixed, n] = fixDeclarations(body);
    count += n;
    return `{${fixed}}`;
  });
  return [out, count];
}

const PAINT_ATTRS = "fill|stroke|stop-color|flood-color|lighting-color|color";

/** Apply style fixes to markup (never inside script bodies). */
function fixMarkup(markup: string): [string, number] {
  let count = 0;
  const add = ([s, n]: [string, number]) => {
    count += n;
    return s;
  };
  const out = markup
    .replace(
      /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
      (_w, open: string, css: string, close: string) =>
        open + add(fixStylesheet(css)) + close,
    )
    .replace(
      /(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/gi,
      (_w, lead: string, q: string, css: string) =>
        lead + q + add(fixDeclarations(css)) + q,
    )
    .replace(
      new RegExp(`(\\s(?:${PAINT_ATTRS})\\s*=\\s*)(["'])([^"']*)\\2`, "gi"),
      (_w, lead: string, q: string, value: string) =>
        lead + q + add(fixColorValue(value)) + q,
    );
  return [out, count];
}

/* ------------------------------------------------------------------ */
/*  Errors                                                             */
/* ------------------------------------------------------------------ */

/** Checked against script code (script bodies and on* handlers), so prose
 * like "we fetch (and rank)" never trips them. */
const SCRIPT_RULES: Array<[RegExp, string]> = [
  [
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(|\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest|Worker|SharedWorker)\b|\bimport\s*\(/,
    "makes network requests or loads code (fetch, XHR, WebSocket, workers, dynamic import). The page runs offline: put all data inline.",
  ],
  [
    /\b(?:window\.)?(?:top|parent|opener)\s*\.\s*(?:location|postMessage|document)|\blocation\s*(?:\.\s*(?:href|assign|replace)\s*[=(]|=)|\bwindow\.open\s*\(/,
    "navigates or reaches outside the page (location, window.open, parent, top).",
  ],
  [
    /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie)\b/,
    "uses browser storage. Use artifact.getState() / artifact.setState() to remember what the reader did.",
  ],
];

/** Checked against the markup outside scripts. */
const MARKUP_RULES: Array<[RegExp, string]> = [
  [
    /\b(?:src|href|action|poster|data)\s*=\s*["']?\s*(?:https?:|\/\/|javascript:)|url\(\s*["']?\s*(?:https?:|\/\/)|@import\b/i,
    "references an external URL (src, href, url(), @import). Nothing loads from the network: inline SVG instead of images, and no links.",
  ],
  [/<(?:form|iframe|frame|object|embed|base|link|portal)\b/i, "uses form, iframe, object, embed, base, or link elements."],
  [/<meta\b[^>]*http-equiv/i, "uses a meta http-equiv tag."],
  [/type\s*=\s*["']?password/i, "has a password field."],
];

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

export interface ArtifactLintResult {
  /** The source with style fixes applied. */
  html: string;
  /** Reasons to reject the save; empty when it's fine. */
  errors: string[];
  /** How many raw colors / font families were mapped to theme values. */
  styleFixes: number;
}

const SCRIPT_RE = /(<script\b[^>]*>[\s\S]*?<\/script>)/gi;

export function lintArtifactHtml(html: string): ArtifactLintResult {
  const parts = html.split(SCRIPT_RE);
  const markup = parts.filter((_, i) => i % 2 === 0).join("\n");
  const handlers = [...markup.matchAll(/\son\w+\s*=\s*(["'])([\s\S]*?)\1/gi)].map((m) => m[2]);
  const code = [...parts.filter((_, i) => i % 2 === 1), ...handlers].join("\n");

  const errors: string[] = [];
  for (const [re, message] of SCRIPT_RULES) {
    if (re.test(code)) errors.push(`The page ${message}`);
  }
  for (const [re, message] of MARKUP_RULES) {
    if (re.test(markup)) errors.push(`The page ${message}`);
  }
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) {
    errors.push("The page loads a script by src. Write scripts inline.");
  }

  // Style fixes apply to markup only; script bodies pass through untouched.
  let styleFixes = 0;
  const fixed = parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      const [out, n] = fixMarkup(part);
      styleFixes += n;
      return out;
    })
    .join("");

  return { html: fixed, errors, styleFixes };
}
