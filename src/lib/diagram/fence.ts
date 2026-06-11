/**
 * Fence routing for assistant-generated visuals.
 *
 * The model is taught two visual fences: ```chart, a JSON data spec for the
 * three standard chart shapes drawn by the deterministic native renderer
 * (see CHART_GUIDE and chart-spec.ts), and ```diagram, GenUI HTML/SVG for
 * everything else (see DIAGRAM_GUIDE and diagram-html.ts). Mermaid was
 * retired; its fence languages are still recognized so conversations
 * persisted before the switch degrade to a tidy source-disclosure card
 * instead of dumping raw source into the chat.
 *
 * Pure module (no React, no DOM) so routing rules are unit-testable in the
 * node vitest environment.
 */

/** Fence language for the native HTML diagram (see DIAGRAM_GUIDE). */
export const DIAGRAM_LANG = "diagram";

/** Fence language for the native JSON chart spec (see CHART_GUIDE). */
export const CHART_LANG = "chart";

/**
 * Fence languages emitted by the retired Mermaid pipeline. The model usually
 * fenced with `mermaid`, but sometimes used the diagram type as the language
 * (```flowchart), so those are recognized too.
 */
export const LEGACY_MERMAID_LANGS = new Set([
  "mermaid",
  "flowchart",
  "graph",
  "sequencediagram",
  "statediagram",
  "statediagram-v2",
  "mindmap",
  "timeline",
  "pie",
  "quadrantchart",
  "xychart",
  "xychart-beta",
  "block",
  "block-beta",
  "architecture",
  "architecture-beta",
  "radar",
  "radar-beta",
]);

/** The language token from a code element's className, or null. */
function langFromClass(className: unknown): string | null {
  if (typeof className !== "string") return null;
  const m = /\blanguage-([\w-]+)/.exec(className);
  return m ? m[1].toLowerCase() : null;
}

/** True when the code block is a native ```diagram HTML spec. */
export function isDiagramClass(className: unknown): boolean {
  return langFromClass(className) === DIAGRAM_LANG;
}

/** True when the code block is a native ```chart JSON spec. */
export function isChartClass(className: unknown): boolean {
  return langFromClass(className) === CHART_LANG;
}

/**
 * History hygiene for the model-facing transcript: relabel retired visual
 * fences in PAST assistant turns so the model can't imitate them.
 *
 * The model copies its own earlier messages far more reliably than it obeys
 * prompt instructions, so in an old conversation a single surviving
 * ```mermaid block keeps resurrecting the retired format on every new turn.
 * Relabeling (rather than deleting) keeps the underlying content in context.
 * Storage is never touched — only the transcript sent to the model.
 */
export function retireLegacyVisualFences(markdown: string): string {
  return markdown.replace(
    /^([ \t]*)(`{3,}|~{3,})[ \t]*([\w-]+)[ \t]*$/gm,
    (line, indent: string, ticks: string, lang: string) =>
      LEGACY_MERMAID_LANGS.has(lang.toLowerCase())
        ? `${indent}${ticks}text`
        : line,
  );
}

/** True when the code block is a legacy Mermaid fence (fallback card). */
export function isLegacyMermaidClass(className: unknown): boolean {
  const lang = langFromClass(className);
  return lang !== null && LEGACY_MERMAID_LANGS.has(lang);
}
