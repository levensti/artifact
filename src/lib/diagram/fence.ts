/**
 * Fence routing for assistant-generated visuals: which fenced code blocks
 * render as Mermaid diagrams, and which render as native charts.
 *
 * Pure module (no React, no Mermaid import) so routing rules are
 * unit-testable in the node vitest environment.
 */

/**
 * Mermaid languages the model is TAUGHT today (see DIAGRAM_GUIDE in the chat
 * route). The model usually fences with `mermaid`, but it sometimes uses the
 * diagram type as the language (```flowchart), so the diagram types are
 * accepted as fence languages too.
 */
export const CORE_MERMAID_LANGS = new Set([
  "mermaid",
  "flowchart",
  "graph",
  "sequencediagram",
  "statediagram",
  "statediagram-v2",
  "mindmap",
  "timeline",
]);

/**
 * Mermaid languages we no longer teach — the beta chart grammars whose jobs
 * moved to the native ```chart fence — kept ONLY so persisted conversations
 * from before the switch still render as diagrams instead of raw code.
 * Project-management / software-engineering types (kanban, gantt, gitGraph,
 * classDiagram, ER, etc.) remain intentionally omitted.
 */
export const LEGACY_MERMAID_LANGS = new Set([
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

/** Everything the renderer accepts: taught + legacy. */
export const MERMAID_LANGS = new Set([
  ...CORE_MERMAID_LANGS,
  ...LEGACY_MERMAID_LANGS,
]);

/** Fence language for the native JSON chart spec (see CHART_GUIDE). */
export const CHART_LANG = "chart";

/** The language token from a code element's className, or null. */
function langFromClass(className: unknown): string | null {
  if (typeof className !== "string") return null;
  const m = /\blanguage-([\w-]+)/.exec(className);
  return m ? m[1].toLowerCase() : null;
}

/** The mermaid language token from a code element's className, or null. */
export function mermaidLangFromClass(className: unknown): string | null {
  const lang = langFromClass(className);
  return lang !== null && MERMAID_LANGS.has(lang) ? lang : null;
}

export function isMermaidClass(className: unknown): boolean {
  return mermaidLangFromClass(className) !== null;
}

/** True when the code block is a native ```chart JSON spec. */
export function isChartClass(className: unknown): boolean {
  return langFromClass(className) === CHART_LANG;
}

/**
 * Build the mermaid source to render. If the block was fenced with the
 * diagram type as the language (```flowchart) and the content doesn't
 * already begin with a diagram keyword, prepend it so the source parses.
 */
export function mermaidSource(className: unknown, children: unknown): string {
  const src = String(children ?? "").replace(/\n$/, "");
  const lang = mermaidLangFromClass(className);
  if (!lang || lang === "mermaid") return src;
  const firstWord = src.trimStart().split(/[\s\n]/)[0]?.toLowerCase() ?? "";
  return MERMAID_LANGS.has(firstWord) ? src : `${lang}\n${src}`;
}

/** Friendly name for the diagram, derived from its opening keyword. */
export function diagramTypeName(code: string): string {
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
