import { parseHTML } from "linkedom";
import { fetchAsset } from "./fetch-page";
import { isPublicHttpUrl } from "./url-safety";

/**
 * Freeze a fetched web page into a single self-contained HTML document that
 * renders like the original when served from our origin inside a sandboxed,
 * script-free iframe:
 *
 *   - the page's own markup and inline styles are kept verbatim
 *   - external stylesheets (and their @imports) are fetched and inlined, with
 *     every url() resolved against the sheet that declared it
 *   - images, media and links are rewritten to absolute URLs; lazy-loading
 *     data-* sources are promoted so the pictures actually show
 *   - web fonts are routed through our asset proxy (cross-origin font loads
 *     need CORS headers most sites don't send)
 *   - scripts, frames, embeds, forms' actions, event handlers and
 *     javascript: URLs are stripped
 *
 * The result is the approach reading-mode-free annotators take (Hypothesis'
 * via proxy, archive snapshots): fidelity comes from keeping the page, not
 * re-typesetting it.
 */

export interface SnapshotOptions {
  pageUrl: string;
  contactEmail: string | null;
  /** Build the same-origin proxy URL for a font asset. */
  proxyUrl: (absoluteUrl: string) => string;
}

export interface Snapshot {
  html: string;
  title: string;
  /** Stylesheets that could not be fetched; the page still renders, less
   *  faithfully. */
  failedStylesheets: string[];
}

// Modern sites ship many small per-component sheets (Stripe's blog has 90+),
// so the cap is on bytes, with a generous count as a backstop.
const MAX_STYLESHEETS = 200;
const MAX_STYLESHEET_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_CSS_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_DEPTH = 3;

export const SNAPSHOT_CSP = [
  "default-src 'none'",
  "img-src * data: blob:",
  "media-src * data: blob:",
  "style-src * 'unsafe-inline'",
  "font-src * data:",
  "base-uri 'none'",
  "form-action 'none'",
  "script-src 'none'",
].join("; ");

const REMOVE_SELECTOR = [
  "script",
  "noscript",
  "template",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "base",
  "meta[http-equiv]",
  "link:not([rel~=stylesheet])",
].join(", ");

const LAZY_SRC_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-url"];
const LAZY_SRCSET_ATTRS = ["data-srcset", "data-lazy-srcset"];

function resolve(value: string, base: string): string {
  try {
    return new URL(value.trim(), base).href;
  } catch {
    return value;
  }
}

function isSkippableUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    v === "" ||
    v.startsWith("data:") ||
    v.startsWith("blob:") ||
    v.startsWith("#") ||
    v.startsWith("about:") ||
    v.startsWith("javascript:") ||
    v.startsWith("/api/web-asset?")
  );
}

function rewriteSrcset(srcset: string, base: string): string {
  return srcset
    .split(",")
    .map((part) => {
      const [u, ...rest] = part.trim().split(/\s+/);
      if (!u || isSkippableUrl(u)) return part.trim();
      return [resolve(u, base), ...rest].join(" ");
    })
    .join(", ");
}

/** Rewrite every url() in a CSS string. `fontUrl` handles urls inside
 *  @font-face blocks; `plainUrl` the rest. */
function rewriteCssUrls(
  css: string,
  plainUrl: (u: string) => string,
  fontUrl: (u: string) => string,
): string {
  const URL_RE = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g;
  const rewrite = (chunk: string, map: (u: string) => string) =>
    chunk.replace(URL_RE, (m, q: string, u: string) =>
      isSkippableUrl(u) ? m : `url(${q}${map(u)}${q})`,
    );
  // Split around @font-face blocks so their src urls get the proxy.
  const FONT_FACE_RE = /@font-face\s*\{[^}]*\}/gi;
  let out = "";
  let last = 0;
  for (const m of css.matchAll(FONT_FACE_RE)) {
    const start = m.index ?? 0;
    out += rewrite(css.slice(last, start), plainUrl);
    out += rewrite(m[0], fontUrl);
    last = start + m[0].length;
  }
  out += rewrite(css.slice(last), plainUrl);
  return out;
}

interface CssContext {
  opts: SnapshotOptions;
  fetched: number;
  totalBytes: number;
  failed: string[];
  cache: Map<string, Promise<string | null>>;
}

async function fetchStylesheet(url: string, ctx: CssContext): Promise<string | null> {
  const cached = ctx.cache.get(url);
  if (cached) return cached;
  const p = (async () => {
    if (
      ctx.fetched >= MAX_STYLESHEETS ||
      ctx.totalBytes >= MAX_TOTAL_CSS_BYTES ||
      !isPublicHttpUrl(url)
    ) {
      return null;
    }
    ctx.fetched += 1;
    try {
      const res = await fetchAsset(url, ctx.opts.pageUrl, ctx.opts.contactEmail);
      if (!res.ok) return null;
      const type = res.headers.get("content-type") ?? "";
      if (type && !type.includes("css") && !type.includes("text/plain")) return null;
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_STYLESHEET_BYTES) return null;
      const text = await res.text();
      if (text.length > MAX_STYLESHEET_BYTES) return null;
      ctx.totalBytes += text.length;
      return text;
    } catch {
      return null;
    }
  })();
  ctx.cache.set(url, p);
  return p;
}

/** Inline @imports (recursively, bounded) and absolutize urls in one sheet. */
async function processCss(
  css: string,
  sheetUrl: string,
  ctx: CssContext,
  depth: number,
): Promise<string> {
  const IMPORT_RE =
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/gi;
  const imports: { url: string; media: string }[] = [];
  // Swap each @import for a placeholder first, so the parent's own url()
  // rewriting never touches the imported sheet (which is processed, and its
  // fonts already proxied, on its own).
  const withPlaceholders = css.replace(IMPORT_RE, (_m, _q1, u1: string, _q2, u2: string, media: string) => {
    imports.push({ url: u1 ?? u2, media: (media ?? "").trim() });
    return `/*__SNAPSHOT_IMPORT_${imports.length - 1}__*/`;
  });

  const own = rewriteCssUrls(
    withPlaceholders,
    (u) => resolve(u, sheetUrl),
    (u) => ctx.opts.proxyUrl(resolve(u, sheetUrl)),
  );

  const inlined = await Promise.all(
    imports.map(async (imp) => {
      if (depth >= MAX_IMPORT_DEPTH) return "";
      const abs = resolve(imp.url, sheetUrl);
      const text = await fetchStylesheet(abs, ctx);
      if (text === null) {
        ctx.failed.push(abs);
        return "";
      }
      const inner = await processCss(text, abs, ctx, depth + 1);
      return imp.media ? `@media ${imp.media}{${inner}}` : inner;
    }),
  );
  return own.replace(/\/\*__SNAPSHOT_IMPORT_(\d+)__\*\//g, (_m, i: string) => inlined[Number(i)] ?? "");
}

/** The element holding the page content: normally <body>, but some feeds wrap
 *  the HTML in a non-HTML envelope that leaves the parser's <body> empty. */
function pickBody(doc: Document): HTMLElement | null {
  if (doc.body?.textContent?.trim()) return doc.body;
  for (const b of doc.querySelectorAll("body")) {
    if (b.textContent?.trim()) return b as HTMLElement;
  }
  return doc.body ?? null;
}

function copyAttributes(from: Element | null, to: Element, allow: string[]) {
  if (!from) return;
  for (const name of allow) {
    const v = from.getAttribute(name);
    if (v !== null) to.setAttribute(name, v);
  }
}

export async function buildSnapshot(
  sourceHtml: string,
  opts: SnapshotOptions,
): Promise<Snapshot> {
  const { pageUrl } = opts;
  const { document: src } = parseHTML(sourceHtml);
  const srcBody = pickBody(src);
  const srcHead = src.head ?? src.querySelector("head");
  const srcHtml = src.querySelector("html");
  const title = (src.title || src.querySelector("title")?.textContent || "").trim();

  // Assemble a clean document: head material + body, with html/body
  // attributes carried over since site CSS keys on them.
  const { document: out } = parseHTML(
    "<!doctype html><html><head></head><body></body></html>",
  );
  copyAttributes(srcHtml, out.documentElement, ["lang", "dir", "class", "style"]);
  copyAttributes(srcBody, out.body, ["class", "style", "id", "dir"]);
  if (srcHead) {
    for (const child of Array.from(srcHead.children)) {
      if (["STYLE", "LINK", "TITLE"].includes(child.tagName)) {
        out.head.appendChild(child.cloneNode(true));
      }
    }
  }
  if (srcBody) out.body.innerHTML = srcBody.innerHTML;

  // Drop active and non-content elements.
  for (const el of out.querySelectorAll(REMOVE_SELECTOR)) el.remove();

  const ctx: CssContext = {
    opts,
    fetched: 0,
    totalBytes: 0,
    failed: [],
    cache: new Map(),
  };

  // Inline <style> blocks and style attributes: same url treatment. Collected
  // before the external sheets are inlined so those aren't processed twice.
  for (const style of Array.from(out.querySelectorAll("style"))) {
    style.textContent = await processCss(style.textContent ?? "", pageUrl, ctx, 1);
  }
  for (const el of out.querySelectorAll("[style]")) {
    const s = el.getAttribute("style") ?? "";
    if (s.includes("url(")) {
      el.setAttribute(
        "style",
        rewriteCssUrls(s, (u) => resolve(u, pageUrl), (u) => opts.proxyUrl(resolve(u, pageUrl))),
      );
    }
  }

  // External stylesheets become inline <style>, in document order.
  const links = Array.from(out.querySelectorAll("link[rel~=stylesheet]"));
  await Promise.all(
    links.map(async (link) => {
      const href = link.getAttribute("href");
      if (!href || isSkippableUrl(href)) return link.remove();
      const abs = resolve(href, pageUrl);
      const text = await fetchStylesheet(abs, ctx);
      if (text === null) {
        ctx.failed.push(abs);
        link.remove();
        return;
      }
      const style = out.createElement("style");
      const media = link.getAttribute("media");
      if (media) style.setAttribute("media", media);
      style.textContent = await processCss(text, abs, ctx, 1);
      link.replaceWith(style);
    }),
  );

  // Images, media, links. Server-rendered React emits camelCase attribute
  // names (srcSet); normalise so the lookups below see them.
  for (const el of out.querySelectorAll("img, source, video, audio, track, input[type=image]")) {
    for (const attr of Array.from(el.attributes)) {
      const lower = attr.name.toLowerCase();
      if (lower !== attr.name) {
        el.removeAttribute(attr.name);
        if (!el.hasAttribute(lower)) el.setAttribute(lower, attr.value);
      }
    }
    for (const attr of LAZY_SRC_ATTRS) {
      const lazy = el.getAttribute(attr);
      const cur = el.getAttribute("src");
      if (lazy && (!cur || isSkippableUrl(cur) || /1x1|blank|placeholder|spacer/i.test(cur))) {
        el.setAttribute("src", lazy);
      }
    }
    for (const attr of LAZY_SRCSET_ATTRS) {
      const lazy = el.getAttribute(attr);
      if (lazy && !el.getAttribute("srcset")) el.setAttribute("srcset", lazy);
    }
    const srcv = el.getAttribute("src");
    if (srcv && !isSkippableUrl(srcv)) el.setAttribute("src", resolve(srcv, pageUrl));
    const poster = el.getAttribute("poster");
    if (poster && !isSkippableUrl(poster)) el.setAttribute("poster", resolve(poster, pageUrl));
    const srcset = el.getAttribute("srcset");
    if (srcset) el.setAttribute("srcset", rewriteSrcset(srcset, pageUrl));
    // Native lazy loading inside a tall, non-scrolling frame never fires;
    // let the browser load as it would on a normal page.
    el.removeAttribute("loading");
  }
  for (const a of out.querySelectorAll("a[href], area[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (href.trim().toLowerCase().startsWith("javascript:")) {
      a.removeAttribute("href");
    } else if (!href.startsWith("#") && !isSkippableUrl(href)) {
      a.setAttribute("href", resolve(href, pageUrl));
    }
    a.removeAttribute("target");
    a.removeAttribute("ping");
  }
  for (const form of out.querySelectorAll("form")) form.removeAttribute("action");

  // Event handlers and javascript: URLs anywhere. Also undo inline
  // "hidden until JavaScript reveals it" states (visibility:hidden,
  // opacity:0) that server-rendered animation libraries leave on content;
  // without scripts those would stay hidden forever.
  const HIDDEN_RE = /(^|;)\s*(visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?)\s*(?=;|$)/gi;
  for (const el of out.querySelectorAll("*")) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if (name === "style" && HIDDEN_RE.test(attr.value)) {
        HIDDEN_RE.lastIndex = 0;
        const cleaned = attr.value.replace(HIDDEN_RE, "$1").replace(/^;+|;+$/g, "").trim();
        if (cleaned) el.setAttribute("style", cleaned);
        else el.removeAttribute("style");
      }
      else if (
        (name === "src" || name === "href" || name === "xlink:href") &&
        attr.value.trim().toLowerCase().startsWith("javascript:")
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  // Snapshot head: charset, no referrer on hotlinked assets (hotlink
  // protection usually keys on a foreign referrer, not a missing one),
  // a viewport, and the page title.
  const head = out.head;
  const meta = (attrs: Record<string, string>) => {
    const m = out.createElement("meta");
    for (const [k, v] of Object.entries(attrs)) m.setAttribute(k, v);
    head.insertBefore(m, head.firstChild);
  };
  meta({ name: "viewport", content: "width=device-width, initial-scale=1" });
  meta({ name: "referrer", content: "no-referrer" });
  // The viewer loads the snapshot from a blob: URL, so this meta is the
  // document's own policy: no scripts, frames or form posts, assets from
  // anywhere.
  meta({ "http-equiv": "Content-Security-Policy", content: SNAPSHOT_CSP });
  meta({ charset: "utf-8" });
  if (!head.querySelector("title")) {
    const t = out.createElement("title");
    t.textContent = title || new URL(pageUrl).hostname;
    head.appendChild(t);
  }
  const base = out.createElement("style");
  base.setAttribute("data-snapshot", "");
  // The frame is sized to its content by the host; nothing inside should
  // introduce its own vertical scroller or pin to a viewport that is the
  // whole document.
  base.textContent =
    "html,body{overflow:visible!important;height:auto!important;min-height:0!important}";
  head.appendChild(base);

  const html = "<!doctype html>\n" + out.documentElement.outerHTML;
  return { html, title, failedStylesheets: ctx.failed };
}
