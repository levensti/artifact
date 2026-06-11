"use client";

import { useEffect, useId, useState } from "react";
import ShimmerStatus from "./shimmer-status";
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
