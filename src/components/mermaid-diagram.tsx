"use client";

import { useEffect, useId, useState } from "react";
import ShimmerStatus from "./shimmer-status";

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
      .then((m) => {
        const dark =
          typeof document !== "undefined" &&
          document.documentElement.classList.contains("dark");
        m.default.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "neutral",
          fontFamily: "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
        });
        return m.default;
      })
      .catch((e) => {
        // Don't cache a failed init — let the next render retry.
        mermaidReady = null;
        throw e;
      });
  }
  return mermaidReady;
}

/**
 * Best-effort repair for the single most common way models break Mermaid:
 * unquoted special characters in a node label, e.g. `A[Encoder (repeated)]`.
 * Mermaid reads the `(` as a shape token and throws. Here we wrap any node
 * label that contains risky characters in double quotes.
 *
 * Only ever applied AFTER the original source fails to parse, so a valid
 * diagram is never altered — at worst the repaired version also fails and we
 * fall back to showing the source.
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

function quoteUnsafeLabels(src: string): string {
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
 * Best-effort repair applied only after the original source fails to parse.
 * Quotes unsafe flowchart labels, and for xychart-beta strips any trailing
 * text after a `bar [...]` / `line [...]` array (models add series labels /
 * colors there, which the grammar rejects).
 */
function repairMermaid(src: string): string {
  let out = quoteUnsafeLabels(src);
  if (/^\s*xychart/i.test(out)) {
    // Only rescue a SINGLE-series chart by stripping a stray trailing label.
    // Multiple bar/line series can't be legended in xychart-beta, so we don't
    // strip-and-render them into a misleading legend-less overlay — that case
    // should be a table instead.
    const seriesCount = (out.match(/^\s*(?:bar|line)\s*\[/gim) ?? []).length;
    if (seriesCount === 1) {
      out = out.replace(/^(\s*(?:bar|line)\s*\[[^\]\n]*\]).*$/gim, "$1");
    }
  }
  return out;
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
function renderMermaid(id: string, source: string): Promise<string> {
  const run = renderChain.then(async () => {
    const mermaid = await getMermaid();
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

// Rendered SVGs keyed by source. A diagram renders once per session; later
// mounts of the same block paint instantly and stably.
const svgCache = new Map<string, string>();

/** Friendly name for the diagram, derived from its opening keyword. */
function diagramTypeName(code: string): string {
  const first = code.trim().split(/[\s\n]+/)[0]?.toLowerCase() ?? "";
  const key = first.replace(/-(v2|beta)$/, "");
  const map: Record<string, string> = {
    flowchart: "flowchart",
    graph: "flowchart",
    sequencediagram: "sequence diagram",
    classdiagram: "class diagram",
    statediagram: "state diagram",
    erdiagram: "ER diagram",
    journey: "user journey",
    gantt: "Gantt chart",
    gitgraph: "git graph",
    mindmap: "mindmap",
    timeline: "timeline",
    pie: "pie chart",
    quadrantchart: "quadrant chart",
    xychart: "chart",
    requirementdiagram: "requirements diagram",
    sankey: "Sankey diagram",
    block: "block diagram",
    packet: "packet diagram",
    architecture: "architecture diagram",
    c4context: "C4 diagram",
    kanban: "kanban board",
    radar: "radar chart",
  };
  return map[key] ?? "diagram";
}

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
  const [svg, setSvg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // A cache hit paints instantly (no placeholder flash, no re-parse).
  const shown = svg ?? svgCache.get(source) ?? null;

  useEffect(() => {
    if (streaming || !source || svgCache.has(source)) return;
    let cancelled = false;
    // Small debounce so the final settle doesn't render mid-commit.
    const timer = window.setTimeout(() => {
      void renderMermaid(renderId, source)
        .then((out) => {
          if (cancelled) return;
          svgCache.set(source, out);
          setSvg(out);
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
  }, [source, streaming, renderId]);

  if (shown && !streaming) {
    return (
      <div
        className="chat-mermaid"
        role="img"
        dangerouslySetInnerHTML={{ __html: shown }}
      />
    );
  }

  if (!streaming && errMsg) {
    return (
      <div>
        <p className="chat-mermaid-error">Couldn&rsquo;t render this diagram.</p>
        <pre className="chat-mermaid-fallback">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  // Streaming, or the brief pre-render settle: show the shared in-progress
  // indicator with diagram-specific copy.
  return <ShimmerStatus label={`Drawing the ${diagramTypeName(code)}`} />;
}
