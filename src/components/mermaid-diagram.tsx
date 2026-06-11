"use client";

import { useEffect, useId, useState } from "react";
import ShimmerStatus from "./shimmer-status";
import DiagramFallbackCard from "./diagram-fallback-card";
import DiagramFrame from "./diagram-lightbox";
import { useDocumentDark } from "@/hooks/use-document-dark";
import { diagramTypeName } from "@/lib/diagram/fence";
import { repairMermaid } from "@/lib/diagram/mermaid-repair";

/**
 * Renders a Mermaid diagram from a ```mermaid fenced code block.
 *
 * Mermaid (~heavy) is lazy-loaded on first use so it stays out of the main
 * bundle, and it's initialized exactly once.
 *
 * Concurrency: Mermaid keeps global mutable state and is NOT safe to render
 * concurrently — two simultaneous renders (multiple diagrams in one answer,
 * or React StrictMode's double-invoked effects in dev) race and make the same
 * source intermittently throw, which previously flickered the UI between the
 * diagram and its raw source. So every render goes through a single serial
 * queue, and results are cached by source.
 *
 * Streaming: while the block is still arriving we show a "drawing"
 * placeholder rather than parsing half-written syntax. The implementation
 * detail (Mermaid) is never surfaced — the placeholder names the diagram type.
 */

type MermaidApi = typeof import("mermaid")["default"];

let mermaidReady: Promise<MermaidApi> | null = null;
function getMermaid(): Promise<MermaidApi> {
  if (!mermaidReady) {
    mermaidReady = import("mermaid")
      .then((m) => m.default)
      .catch((e) => {
        // Don't cache a failed load — let the next render retry.
        mermaidReady = null;
        throw e;
      });
  }
  return mermaidReady;
}

const FONT_FAMILY = "var(--font-sans), ui-sans-serif, system-ui, sans-serif";
type ThemeKey = "light" | "dark";

/**
 * Mermaid theme variables read from the app's own palette (the CSS custom
 * properties on :root / .dark), so diagrams match the app exactly instead
 * of Mermaid's stock look. The semantic tokens are plain hex in both themes,
 * which Mermaid's color math (khroma) can parse — keep it that way.
 */
function appThemeVariables(dark: boolean): Record<string, unknown> {
  const styles = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  const foreground = v("--foreground", dark ? "#ececea" : "#37352f");
  const muted = v("--muted", dark ? "#262623" : "#f1f0ec");
  return {
    darkMode: dark,
    fontFamily: FONT_FAMILY,
    background: v("--card", dark ? "#1f1f1d" : "#ffffff"),
    primaryColor: v("--secondary", dark ? "#2a2a27" : "#f1f1ef"),
    primaryTextColor: foreground,
    primaryBorderColor: v("--input", dark ? "#35332f" : "#e1e0db"),
    secondaryColor: muted,
    tertiaryColor: v("--card", dark ? "#1f1f1d" : "#ffffff"),
    lineColor: v("--muted-foreground", dark ? "#a7a49e" : "#787570"),
    textColor: foreground,
    noteBkgColor: muted,
    noteTextColor: foreground,
  };
}

// Re-initialize only when the theme actually flips. Mermaid's config is
// global, so this must happen inside the serial render chain.
let appliedTheme: ThemeKey | null = null;
function ensureTheme(mermaid: MermaidApi, theme: ThemeKey): void {
  if (appliedTheme === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: appThemeVariables(theme === "dark"),
    fontFamily: FONT_FAMILY,
  });
  appliedTheme = theme;
}

// Serialize all renders — one at a time — to avoid racing Mermaid's globals.
let renderChain: Promise<unknown> = Promise.resolve();
async function attemptRender(
  mermaid: MermaidApi,
  id: string,
  source: string,
): Promise<string> {
  await mermaid.parse(source); // throws on invalid syntax
  const { svg } = await mermaid.render(id, source);
  return svg;
}
function renderMermaid(
  id: string,
  source: string,
  theme: ThemeKey,
): Promise<string> {
  const run = renderChain.then(async () => {
    const mermaid = await getMermaid();
    ensureTheme(mermaid, theme);
    try {
      return await attemptRender(mermaid, id, source);
    } catch (err) {
      // Retry once with common model mistakes auto-repaired.
      const repaired = repairMermaid(source);
      if (repaired !== source) {
        return await attemptRender(mermaid, `${id}-r`, repaired);
      }
      throw err;
    }
  });
  // Keep the chain alive even if this render rejects.
  renderChain = run.catch(() => undefined);
  return run;
}

// Rendered SVGs keyed by theme + source. A diagram renders once per theme
// per session; later mounts of the same block paint instantly and stably,
// and flipping the theme back is a cache hit.
const svgCache = new Map<string, string>();

export default function MermaidDiagram({
  code,
  streaming = false,
}: {
  code: string;
  streaming?: boolean;
}) {
  // useId yields ":r0:"-style strings; strip the colons for a valid DOM id.
  const renderId = `mermaid-${useId().replace(/:/g, "")}`;
  const source = code.trim();
  const theme: ThemeKey = useDocumentDark() ? "dark" : "light";
  const cacheKey = `${theme}::${source}`;
  // State only triggers re-renders; the SVG itself lives in the cache so a
  // theme flip (new key) never shows a stale-theme diagram.
  const [rendered, setRendered] = useState<{ key: string; svg: string } | null>(
    null,
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // A cache hit paints instantly (no placeholder flash, no re-parse).
  const shown =
    svgCache.get(cacheKey) ??
    (rendered?.key === cacheKey ? rendered.svg : null);

  useEffect(() => {
    if (streaming || !source || svgCache.has(`${theme}::${source}`)) return;
    let cancelled = false;
    // Small debounce so the final settle doesn't render mid-commit.
    const timer = window.setTimeout(() => {
      void renderMermaid(renderId, source, theme)
        .then((out) => {
          if (cancelled) return;
          svgCache.set(`${theme}::${source}`, out);
          setRendered({ key: `${theme}::${source}`, svg: out });
          setErrMsg(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          console.error("[mermaid] render failed:", err, "\nsource:\n", source);
          setErrMsg(err instanceof Error ? err.message : String(err));
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, streaming, renderId, theme]);

  if (shown && !streaming) {
    return (
      <DiagramFrame
        title={diagramTypeName(code)}
        className="chat-mermaid"
        expanded={
          <div
            className="chat-mermaid-expanded"
            role="img"
            dangerouslySetInnerHTML={{ __html: shown }}
          />
        }
      >
        <div
          className="chat-mermaid-body"
          role="img"
          dangerouslySetInnerHTML={{ __html: shown }}
        />
      </DiagramFrame>
    );
  }

  if (!streaming && errMsg) {
    return <DiagramFallbackCard kind="diagram" source={code} />;
  }

  // Streaming, or the brief pre-render settle: show the shared in-progress
  // indicator with diagram-specific copy.
  return <ShimmerStatus label={`Drawing the ${diagramTypeName(code)}`} />;
}
