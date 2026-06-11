/**
 * Agentic chat endpoint.
 *
 * Implements a server-side ReAct loop: the LLM can call tools (arXiv search,
 * web search, etc.) as many times as needed, and the loop feeds results
 * back until the LLM produces a final text response.
 *
 * Streams NDJSON events to the client:
 *   {"type":"text_delta","text":"..."}
 *   {"type":"tool_call","id":"...","name":"...","input":{...}}
 *   {"type":"tool_result","id":"...","name":"...","output":"..."}
 *   {"type":"error","message":"..."}
 *   {"type":"done"}
 */

import { NextRequest } from "next/server";
import { OPENROUTER_CONTEXT_WINDOW } from "@/lib/openrouter";
import type { StreamEvent } from "@/lib/stream-types";
import { jsonError } from "@/lib/api-utils";
import { getAllTools } from "@/tools/registry";
import type { ToolContext } from "@/tools/types";
import {
  estimateTokens,
  fitTranscriptToBudget,
  type TranscriptMessage,
} from "@/lib/transcript";
import {
  processStreamEvent,
  stepsToBlocks,
  stepsToContent,
  type AgentStep,
} from "@/lib/agent-steps";
import { retireLegacyVisualFences } from "@/lib/diagram/fence";
import { requireUserId, HttpError, errorResponse } from "@/server/api";
import { resolveMeteredKey, charge, meteredTokens } from "@/server/rate-limit";
import * as store from "@/server/store";
import { buildPaperBlock } from "./paper-block";
import { runOpenRouterAgentLoop } from "./openrouter-handler";
import type { ChatMessage, ParsedPaper } from "@/lib/review-types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatRequest {
  /**
   * Stateless history (legacy path). Used by the discover surface and the
   * selection-thread chat: the client owns the transcript and sends it inline.
   * For the main review chat the server now owns state — see `userMessage`.
   * Assistant messages may carry structured `blocks` (text interleaved with
   * tool calls + outputs) so the agent can replay its own prior tool work.
   */
  messages?: TranscriptMessage[];
  /**
   * Server-owned path (main review chat). The new user message text. When
   * present (with `reviewId`, non-discover), the server loads the conversation
   * from the DB, appends + persists this turn, budgets it to the model's
   * context window, and persists the assistant reply on completion — the
   * client no longer sends or stores the history.
   */
  userMessage?: string;
  /** Client-generated id for the new user message, so optimistic UI and the
   *  persisted row share an id. Re-sending the same id is idempotent (a retry
   *  re-runs the stored turn instead of duplicating it). */
  userMessageId?: string;
  /** Client-generated id for the assistant reply, for the same id alignment. */
  assistantMessageId?: string;
  /** Re-run the last stored user message without appending a new one. Used by
   *  the Exa-key resume flow after the turn paused waiting on a key decision. */
  resume?: boolean;
  /** Optional per-user OpenRouter key override. Server falls back to env. */
  apiKey?: string;
  /**
   * Full paper text. For short papers (<~30k tokens) the browser sends this
   * and the agent works directly off it. For long papers, the browser sends
   * `parsedPaper` instead and the agent fetches sections on demand via tools.
   */
  paperContext?: string;
  /**
   * Structured paper representation (L1 summary, sections, references). Sent
   * for long papers in place of `paperContext`. When present, the chat handler
   * puts only the summary + table of contents in the system prompt and
   * exposes `read_section` / `search_paper` / `lookup_citation` for detail.
   */
  parsedPaper?: ParsedPaper;
  paperTitle?: string;
  arxivId?: string;
  reviewId?: string;
  /** Set when the review is for an arbitrary web page rather than a paper/PDF. */
  sourceUrl?: string;
  /**
   * Selects which system prompt and tool subset to use. Default is the
   * paper/web reading agent. `"discover"` swaps in a discovery-focused
   * prompt and (since there's no paper context) only registers
   * `arxiv_search` and `web_search` — paper-internal tools are already
   * gated by `parsedPaper` so they self-disable in this mode.
   */
  mode?: "discover";
  /**
   * User-provided Exa API key. When absent the `web_search` tool returns
   * a sentinel that the chat UI surfaces as a configure card.
   */
  exaApiKey?: string;
  /**
   * Set when the user has explicitly dismissed the "configure Exa key"
   * card and wants the agent to proceed without web search. The chat
   * handler unregisters `web_search` for the turn so the agent doesn't
   * attempt it again.
   */
  skipWebSearch?: boolean;
}

/* ------------------------------------------------------------------ */
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

/** Exa-backed `web_search` description + sentinel handling. Shared across all
 *  three surfaces so the neural-query phrasing guidance never drifts. */
const WEB_SEARCH_NOTE =
  "`web_search` — ground claims with real sources and current documentation. " +
  "Backed by Exa's neural search: phrase the query as a natural-language description of " +
  'the ideal page ("a clear explanation of X for someone who knows Y"), not as keywords. ' +
  'If it returns "EXA_KEY_REQUIRED", the UI is already prompting the user to add a key — ' +
  "do NOT verbalize the failure; continue with what you have.";

/** Never-fabricate rule. Shared by the reading and discover surfaces. */
const NEVER_INVENT =
  "Never invent papers, URLs, or arXiv IDs. If you're unsure a citation is real, " +
  "search for it or leave it out.";

/** Knowledge-first, but search-to-fill-gaps: answer from expertise by default,
 *  and when you genuinely lack something, fetch it instead of disclaiming. */
const KNOWLEDGE_FIRST =
  "Lean on your own knowledge first — you have deep expertise across these topics, so answer " +
  "directly when you can. But when a question needs something you don't have — real papers to " +
  "cite, recent developments, or external facts — use a tool to find out rather than guessing or replying that you don't know.";

/** Selection-thread grounding. Applies to both reading surfaces. */
const THREAD_GROUNDING =
  "When the user starts a thread from a quoted passage, ground your answer in that " +
  "passage and the surrounding context it comes from.";

/** Length + tone calibration. Identical across reading surfaces. */
const LENGTH_AND_TONE = `Length — match the answer to the question. There is no target length.
- Clarifications and definitions usually take 1–3 sentences.
- Focused questions ("what's the key claim?", "summarize a section") usually take a tight paragraph.
- Walkthroughs ("explain the method end-to-end", "compare to prior work") take structured multi-paragraph prose with equations and refs.

Don't restate the question, don't preface with "Great question", don't add caveats unless they actually matter. Be selective — surface what matters for this question, not everything you know.`;

/** Curated reading-list format, used when the user asks what to read next. */
const PICKS_FORMAT =
  'When the user explicitly asks for a list of papers to read (e.g. "find related work ' +
  'on X", "what should I read after this?"), emit a curated list under a `**Picks**` ' +
  "heading: 3–7 numbered items, each as " +
  "`**[Title](https://arxiv.org/abs/ID)** — one sentence on why it fits.` " +
  "(No abstract paraphrase, no author/year/venue — those render as a card around the " +
  "link.) Don't use the Picks format for normal explanatory answers.";

/**
 * GenUI diagram reference. The model draws with HTML and inline SVG inside a
 * \`\`\`diagram fence; the app sanitizes it (diagram-html.ts) and renders it
 * natively. The contract is "unbounded structure, bounded palette": any
 * layout or drawing the model can express is allowed, but colors must come
 * from theme variables (the sanitizer strips raw colors) so every visual
 * stays on the app palette — and restyles retroactively when the palette
 * changes, since persisted output stores token names rather than literal
 * colors. This replaced Mermaid: layout is ordinary
 * flexbox/SVG the model already understands instead of a graph-layout engine
 * we can't steer, and there is no grammar to parse-fail. The guide pairs the
 * capabilities with the content discipline (collapse repetition, one concern
 * per diagram) that actually separates a clear diagram from a wall of boxes.
 */
const DIAGRAM_GUIDE = `Diagram reference. When a method, architecture, flow, relationship, or bespoke visualization is genuinely clearer drawn than described, emit a fenced code block whose language tag is literally \`diagram\`, containing HTML. The app sanitizes it and renders it natively in its own theme. Never use ASCII art, and never emit Mermaid syntax.

Capabilities — structure is unbounded, the palette is not:
- Tags: div, span, strong, em, br; table/thead/tbody/tr/th/td for matrix layouts; inline SVG (svg, g, path, rect, circle, ellipse, line, polyline, polygon, text, tspan) for freeform drawing — custom plots, geometry, annotated shapes. Give every svg a viewBox and no fixed width (it scales to fit); svg text inherits the app font and defaults to the theme text color when you omit fill.
- Attributes: class (the dx-* building blocks below), style for layout/sizing/typography (flex, grid, width, padding, border, border-radius, font-size, transform, ...), and SVG geometry/paint attributes.
- COLORS ARE THEME-BOUND. Every color — CSS or SVG fill/stroke — must be a theme variable: var(--chart-1) … var(--chart-5) for data/categorical color; var(--foreground), var(--muted-foreground), var(--border), var(--secondary), var(--primary) for structure; tints via color-mix(in srgb, var(--chart-2) 25%, transparent). Raw hex/rgb/named colors are STRIPPED by the sanitizer — every color must come from the app palette so visuals stay consistent with it.
- Aesthetic: the app is warm neutrals with an ink-indigo accent, and the chart tokens are a blue ramp (dark indigo → periwinkle → steel → slate). Default to neutrals plus ONE accent — var(--chart-1) or var(--primary); spread across var(--chart-2…5) only when categories genuinely need telling apart. Color encodes meaning, never decoration.
- Also stripped: scripts, event handlers, images, links, url(), position, z-index, font-family. Don't rely on them.

Themed building blocks — prefer these over hand-rolled styles where they fit; they handle the palette and spacing for you:
- dx-title — one short title line, the first element. dx-note — one small footnote line, the last element.
- dx-stack — children flow top to bottom. dx-row — children flow left to right, boxes sharing the width. Nest freely.
- dx-node — a labeled box. Variants: dx-accent (the 1–2 components the diagram is actually about), dx-soft (supporting parts), dx-dashed (external/optional). Inside a node, <span class="dx-sub">…</span> adds a small caption line.
- dx-group — a bordered container for a subsystem/phase/unit; first child is <div class="dx-group-title">Name</div>.
- dx-arrow — a connector placed BETWEEN siblings: it points down inside a stack and right inside a row, automatically. Its text is the edge label (may be empty). Variants: dx-bi (bidirectional), dx-loop (feedback/cycle).
- dx-badge — small pill for a count or stage number, e.g. <span class="dx-badge">×4</span> in a group title.

Discipline — what separates a clear diagram from a wall of boxes:
- Draw the ESSENCE, not the inventory. One concern per diagram: the data flow OR the failure path OR the topology. Say the rest in prose around it.
- Collapse repetition: NEVER draw N identical siblings. Draw one representative and mark multiplicity with a badge ("Replica ×4"); use dx-sub for what varies between copies.
- Budget: ≤ 12 boxes, ≤ 6 words per label, ≤ 2 levels of nesting. If it doesn't fit, the diagram is doing too much — simplify the abstraction, don't shrink the boxes.
- The panel is narrow: prefer stacks; keep rows to ≤ 3 boxes; plain-text labels (no LaTeX or $…$, no markdown).

Example — shape and idioms (title, a collapsed ×N group, labeled arrows, one accent):

\`\`\`diagram
<div class="dx-title">One training step</div>
<div class="dx-stack">
  <div class="dx-node dx-soft">Mini-batch</div>
  <div class="dx-arrow"></div>
  <div class="dx-group">
    <div class="dx-group-title">Replica <span class="dx-badge">×4</span></div>
    <div class="dx-row">
      <div class="dx-node">Forward</div>
      <div class="dx-arrow">activations</div>
      <div class="dx-node">Backward</div>
    </div>
  </div>
  <div class="dx-arrow dx-bi">all-reduce gradients</div>
  <div class="dx-node dx-accent">Optimizer update</div>
</div>
\`\`\`

Freeform plots — any chart shape beyond the standard bar/line/pie (those go in a \`\`\`chart block, see the chart reference) is drawn right here in SVG: scatter, histograms, heatmaps, distributions, annotated geometry. Rules that keep them readable:
- NEVER hand-draw a bar, line, or pie chart here — the \`\`\`chart block draws those exactly. Hand-drawn arc math and bar proportions come out wrong.
- Label everything: every axis gets a name, every point/bar/region gets a label or a legend. An unlabeled chart is decoration, not information.
- Recipe: viewBox about 240 wide; axes and gridlines as thin lines in var(--border); data in var(--chart-1…5); labels as <text font-size="9" fill="var(--muted-foreground)">; work out pixel coordinates from your data values before writing them.

Example scatter:

\`\`\`diagram
<div class="dx-title">Latency vs accuracy</div>
<svg viewBox="0 0 240 130">
  <line x1="30" y1="110" x2="232" y2="110" stroke="var(--border)"></line>
  <line x1="30" y1="8" x2="30" y2="110" stroke="var(--border)"></line>
  <circle cx="64" cy="78" r="3" fill="var(--chart-1)"></circle>
  <circle cx="118" cy="46" r="3" fill="var(--chart-1)"></circle>
  <circle cx="196" cy="28" r="3" fill="var(--chart-1)"></circle>
  <text x="70" y="82" font-size="8" fill="var(--muted-foreground)">7B</text>
  <text x="124" y="50" font-size="8" fill="var(--muted-foreground)">70B</text>
  <text x="202" y="32" font-size="8" fill="var(--muted-foreground)">405B</text>
  <text x="131" y="124" font-size="8" fill="var(--muted-foreground)" text-anchor="middle">latency (ms)</text>
</svg>
\`\`\`

Choosing a visual: a standard bar/line/pie of plain numbers → \`\`\`chart (see the chart reference); any other visual — flows, architectures, scatter or custom plots, matrices, timelines, geometric intuition — → \`\`\`diagram; comparison grids of text/flags → Markdown table; ≤ 3 items or what one sentence can state → prose. At most one visual per answer unless asked. \`\`\`mermaid is a RETIRED format you may still see in older turns — never emit it.`;

/**
 * The native chart fence: the deterministic fast path for the three standard
 * chart shapes. The model emits a tiny JSON data spec and the app renders it
 * with its own theme-native components (see chart-spec.ts and
 * chart-renderer.tsx), so bars/lines/pies are always exact — an experiment
 * having the model hand-draw these in the diagram fence produced malformed
 * arcs and missing labels. Freeform shapes stay GenUI-drawn (DIAGRAM_GUIDE),
 * so this fence is a fast path, never a capability ceiling.
 */
const CHART_GUIDE = `Chart reference. The three standard chart shapes — bar, line, pie — have a fast path: emit a fenced code block whose language tag is \`chart\` containing ONLY a JSON object (no prose, no comments), and the app renders it natively, exact and polished. This fence is a convenience, not the limit of what you can plot: ANY other chart shape — scatter, histogram, heatmap, error bars, radar — you draw yourself in a \`\`\`diagram fence with SVG (see the diagram reference). A chart request is never unsatisfiable.

Fields:
- "type": "bar" (compare quantities across items — the default), "line" (trend across an ordered axis), or "pie" (parts of a whole; ≤ 8 slices, so fold a long tail into one "Other" slice yourself).
- "title": short title.
- "unit": optional value suffix ("%", "ms", "GB"). Values stay raw numbers — never strings, never pre-formatted.
- "labels": one per data point — ≤ 12 categories for bar/pie; a line may carry up to 120 points (axis labels are auto-thinned).
- "series": 1–4 of {"name": …, "values": […]}; each values array aligns 1:1 with labels. Multiple series compare 2–4 models/methods (grouped bars, multiple lines); "name" each series when there is more than one.
- "sort": optional "desc" or "asc" to rank a single-series bar.

When NOT to chart: text cells, ✓/✗ flags, or mixed units → Markdown table; a single number → prose.

Examples (each is valid as-is):

\`\`\`chart
{"type": "bar", "title": "Inference latency", "unit": "ms", "sort": "asc", "labels": ["Model A", "Model B", "Model C"], "series": [{"values": [38, 95, 142]}]}
\`\`\`

\`\`\`chart
{"type": "line", "title": "Accuracy vs model size", "unit": "%", "labels": ["1B", "7B", "70B"], "series": [{"name": "Zero-shot", "values": [41, 58, 71]}, {"name": "Few-shot", "values": [49, 66, 78]}]}
\`\`\``;

/**
 * Pinned after the conversation history every turn (see
 * AgentLoopOptions.trailingSystemReminder). A long conversation accumulates
 * the model's own earlier visuals — possibly malformed or in retired formats
 * — and the model imitates those examples over the guides at the top of the
 * system prompt. Recency wins, so the non-negotiable format rules are
 * restated here, closest to generation.
 */
const VISUAL_FORMAT_REMINDER = `Format reminder for this reply (overrides anything earlier turns did): a bar, line, or pie chart is ALWAYS a \`\`\`chart fence containing only the JSON spec — never hand-drawn SVG arcs or bars, no matter how earlier turns drew charts. Any other visual is a \`\`\`diagram fence (HTML/SVG, every axis and data point labeled, colors only from var(--…) theme tokens). Never emit \`\`\`mermaid. Otherwise follow the system prompt.`;

type ReadingKind = "paper" | "web";

/**
 * Build the system prompt for a reading surface (paper or web page). The two
 * are the same agent: they differ only in the source noun, how the source
 * appears in context, and the citation style. Everything else — tools, search
 * policy, length, tone, format — is shared, so web reading gets the same
 * grounding discipline papers do.
 */
function buildReadingPrompt(kind: ReadingKind): string {
  const isPaper = kind === "paper";
  const noun = isPaper ? "paper" : "page";

  const role = isPaper
    ? "You are a research assistant working alongside someone reading an academic paper. Your job: help them understand the paper deeply and the ideas around it — explain, search, discover, connect."
    : "You are a research assistant working alongside someone reading a web page — an article, blog post, or documentation. Your job: help them understand it deeply and the ideas around it — explain, search, discover, connect.";

  // Both surfaces support long-mode: a short source arrives as full text; a
  // long one is parsed to a summary + ToC with the source-internal tools
  // registered (the chat route gates those tools on the parsed paper).
  const sourceInContext = `How the ${noun} appears in your context:
- For a short ${noun}, the source block contains the full text. Read it directly.
- For a long ${noun}, the source block contains only the title, an L1 summary, and a numbered table of contents. Use \`read_section\` (by name or index), \`search_paper\` (to find passages by query), or \`lookup_citation\` (to resolve a reference) to fetch specific content. Don't pretend to read what you haven't fetched — if the summary doesn't cover a question, fetch the relevant section.`;

  const tools = `Tools:
- \`read_section\`, \`search_paper\`, \`lookup_citation\` — source-internal content (long-${noun} mode only)
- \`arxiv_search\` — search Semantic Scholar + arXiv for papers
- ${WEB_SEARCH_NOTE}`;

  const grounding = isPaper
    ? `Citations:
- Cite the paper inline for every distinct statement you make about it. Each one gets its own locator. Don't bundle multiple statements behind a single trailing reference.
- Sections: write "(§N)", "(§N.M)", or "(§N.M.K)". Always cite at the deepest subsection level that actually grounds the claim. Prefer "(§4.2.1)" over "(§4.2)" when the statement comes from that subsection specifically.
- Figures: write "(Fig. N)" — e.g. "(Fig. 3)" or "(Fig. 3.2)". For multi-panel figures, cite the parent number and describe the panel in prose ("the right panel of (Fig. 3) shows..."), not "(Fig. 3a)".
- Tables: write "(Table N)" — e.g. "(Table 1)". Tables are dense, so always pair the citation with the specific row, column, or comparison you want the reader to focus on ("the 'GLUE avg.' column of (Table 2)").
- Equations: write "(Eq. N)". A cited work in the reference list: write "(Ref. [key])".
- These all auto-render as clickable nav chips.
- ${THREAD_GROUNDING}`
    : `Grounding:
- Anchor every claim about the page in the page itself: quote the key phrase or name the heading/section it comes from rather than paraphrasing vaguely.
- For arXiv papers you surface via search, cite them with the abs link.
- ${THREAD_GROUNDING}`;

  const format = `Format:
- Math: LaTeX wrapped in $ (inline) or $$ (block).
- For arXiv papers found via search, include the link https://arxiv.org/abs/ID.
- Default to prose. Use lists or headers only when the answer is genuinely list-shaped (comparing N items, an M-step walkthrough).
- Tables: use a GitHub-flavored Markdown table only when every cell is a terse, scannable value — numbers, short labels, ✓/✗ — lined up so columns compare at a glance (e.g. models × metrics, methods × properties). Give every column a header. If a column would hold full sentences or a paragraph (a description, a "why it matters", a rationale), that's not a table — use a list with a bold lead-in and the explanation beneath, or prose. Never put multi-sentence text in a cell, and don't table a single pair.
- Visuals: emit a \`\`\`diagram block (see the diagram reference below) when a method, architecture, flow, or relationship is genuinely clearer drawn than described; emit a \`\`\`chart block (see the chart reference below) for standard numeric charts; otherwise prefer prose or a table. When the user asks for a chart, plot, diagram, or any visualization, ALWAYS satisfy it — never tell them what you can or can't render, and never mention fences, formats, or tools.
- ${PICKS_FORMAT}`;

  return [
    role,
    sourceInContext,
    tools,
    KNOWLEDGE_FIRST,
    grounding,
    LENGTH_AND_TONE,
    format,
    DIAGRAM_GUIDE,
    CHART_GUIDE,
    NEVER_INVENT,
  ].join("\n\n");
}

const PAPER_SYSTEM_PROMPT = buildReadingPrompt("paper");
const WEB_SYSTEM_PROMPT = buildReadingPrompt("web");

const DISCOVERY_SYSTEM_PROMPT = `You are a research discovery agent. Your job is to help the user UNDERSTAND a topic, not to dump a pile of links on them. Each run produces two things: a short synthesized explainer that actually teaches the topic, and a curated reading list (via \`submit_picks\`) of the few sources worth reading. Sources are arXiv / Semantic Scholar papers AND high-signal web sources (lab blog posts, technical writeups from researchers or companies, official docs, authoritative surveys) — web sources are first-class picks, not a fallback. For practical or engineering topics ("deterministic LLM training", "RAG eval setup", "vLLM tuning"), a well-written blog post often beats an academic paper; don't reflexively reach for arXiv when the better resource is on the web.

DEPTH OVER BREADTH. This is the most important thing. A good run is a few well-chosen searches, the handful of sources that genuinely matter, and a clear synthesis — NOT a dozen searches enumerating every sub-angle and twenty verified candidates. The user wants understanding and a short, confident reading list, not exhaustive recall. Resist the urge to run a separate search for every sub-topic you can think of; that produces a wall of noise, not insight. Pick the threads that matter and go.

How you work:
- Two search tools, different query styles: \`arxiv_search\` takes concrete keywords; \`web_search\` (Exa, neural) takes a natural-language description of the ideal page ("an engineering blog post on tuning vLLM throughput for long contexts"). Run \`web_search\` by default unless the query is clearly purely academic ("speculative decoding 2024 NeurIPS papers").
- Keep it tight: 2–4 searches TOTAL is usually enough to map a topic. Emit them together in ONE turn so they run in parallel. Only broaden (with different terminology) if that first batch came back thin — don't pre-emptively fan out across every angle.
- Verify only the few candidates you actually intend to recommend — call \`paper_details\` on roughly 3–6 of them, together in one parallel turn, not on every result you saw. \`paper_details\` accepts either a bare arXiv id ("2401.12345") or the full URL. Titles mislead, so verify before committing; web candidates need no separate call (use the search snippet).
- If your searches come back empty, broaden before giving up: swap the user's jargon for the canonical academic term ("bitwise determinism" → "deterministic training"), drop an over-specific token, or search the underlying problem instead of the named solution. Only when two genuinely different rounds return literally nothing should you give a one-to-two-sentence refusal suggesting a reformulation.
- If \`web_search\` returns "EXA_KEY_REQUIRED", the UI is handling it — continue with what you have and don't verbalize it.

What you deliver:
1. Call \`submit_picks\` exactly once with 4–6 picks (fewer if the pool is genuinely small — a short confident list beats a padded one). Mix papers and web freely. Each pick: the canonical URL (arXiv abs URL for papers, source URL for web), the title, and a one-sentence rationale grounded in evidence — the verified TLDR/abstract for papers, the search description for web — that says what the source actually contributes, not a paraphrase of its title. Set \`arxivId\` only for arXiv picks.
2. After \`submit_picks\` returns, write the EXPLAINER: one to two short paragraphs of tight prose that genuinely teach the topic. Lead with the core idea in plain terms, then lay out the main threads and how the work divides, then say which pick to read first and why. Reference your picks inline by title (e.g. "the DiT architecture (Peebles & Xie)") so the reader can connect each claim to a source. This is the headline the user reads first — it must stand on its own as a useful explanation, not a meta-description of your search. No headers, no bullet lists, prose only. NEVER "Picks submitted." and never just a restatement of the titles. Then stop.

Constraints:
- \`submit_picks\` is the only way the reading list reaches the user. Once any search has returned anything, you MUST call it — never trail off into text without it, never end a turn with no tool call and no submitted picks. If you write text in a turn, any tool calls for that turn MUST live in the same response.
- A clarifying question is a LAST RESORT, allowed only when the query is genuinely contentless — a bare term with nothing concrete to search on (e.g. "AI", "help", "models") — and only before you've searched. Anything topical ("linear attention", "RAG", "transformers", "diffusion") IS searchable: choose the most useful interpretation, lead with the dominant thread, and let the user refine via follow-up. Ambiguity between sub-angles (foundational vs. engineering, image vs. video, theory vs. SOTA) is NOT a reason to ask — pick the most useful reading and name the angle you led with in the explainer.
- ${NEVER_INVENT}

Tone: dense, librarian-level. Technical user.`;

function getSystemPrompt(
  sourceUrl: string | undefined,
  mode: ChatRequest["mode"],
): string {
  if (mode === "discover") return DISCOVERY_SYSTEM_PROMPT;
  return sourceUrl ? WEB_SYSTEM_PROMPT : PAPER_SYSTEM_PROMPT;
}

/* ------------------------------------------------------------------ */
/*  POST handler                                                       */
/* ------------------------------------------------------------------ */

/** NDJSON headers shared by the streaming response and the rate-limit reject. */
const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Transfer-Encoding": "chunked",
  "Cache-Control": "no-cache",
} as const;

/**
 * Reject a request that exceeded the platform token budget. Emits the same
 * in-stream `rate_limit` error the client already handles for upstream 429s,
 * so the UI shows its "add your own OpenRouter key" prompt with no client
 * changes. Returned with HTTP 200 (the payload is the NDJSON stream) so the
 * client parses events rather than treating it as a transport failure.
 */
function rateLimitedResponse(): Response {
  const events: StreamEvent[] = [
    {
      type: "error",
      code: "rate_limit",
      message:
        "You've reached the current usage limit. Add your own OpenRouter key for higher limits.",
    },
    { type: "done" },
  ];
  const body = events.map((e) => JSON.stringify(e) + "\n").join("");
  return new Response(body, { headers: NDJSON_HEADERS });
}

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const {
    messages,
    userMessage,
    userMessageId,
    assistantMessageId,
    resume,
    apiKey,
    paperContext,
    parsedPaper,
    paperTitle,
    arxivId,
    reviewId,
    sourceUrl,
    exaApiKey,
    skipWebSearch,
    mode,
  } = body;

  // Server-owned path: the main review chat sends a single `userMessage` + a
  // `reviewId` instead of the full transcript, and the server owns load /
  // persist / context-budgeting. Discover and the selection-thread chat keep
  // the legacy stateless `messages` array.
  const isStateful =
    mode !== "discover" &&
    typeof reviewId === "string" &&
    reviewId.length > 0 &&
    (typeof userMessage === "string" || resume === true);

  if (!isStateful && (!Array.isArray(messages) || messages.length === 0)) {
    return jsonError("Messages array is required and must not be empty.", 400);
  }

  // Resolve the OpenRouter key, spending the user's free platform allowance
  // before falling back to their own key. `meter` is true only while we're on
  // the platform key — usage is charged to the user's buckets after the stream
  // (see the cache_stats accumulation below). This gates both the assistant and
  // discovery surfaces, since both run through this route. Never echoed back.
  let resolvedApiKey: string;
  let meter = false;
  let meterUserId: string | null = null;
  try {
    const outcome = await resolveMeteredKey(apiKey);
    if (!outcome.ok) {
      // Out of allowance with no personal key → surface the BYOK prompt the
      // client already renders for the upstream-429 path below.
      if (outcome.reason === "rate_limited") return rateLimitedResponse();
      return jsonError("API key is required.", 401);
    }
    resolvedApiKey = outcome.apiKey;
    meter = outcome.meter;
    meterUserId = outcome.userId;
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err);
    throw err;
  }

  const trimmedExaKey =
    typeof exaApiKey === "string" ? exaApiKey.trim() : "";
  // Always register all tools — web_search included. When the user has no
  // Exa key, the tool returns a sentinel that the chat UI surfaces as an
  // inline "Add Exa API key" card rather than the agent verbalizing the
  // failure. The exception: if the user dismissed the card, we drop
  // web_search so the agent can't even try. We also drop the paper-internal
  // tools (read_section / search_paper / lookup_citation) when the paper
  // hasn't been parsed into structured form — otherwise the agent sees them
  // in its toolset and calls them only to get a "not parsed yet" error back.
  const PAPER_PARSED_TOOLS = new Set([
    "read_section",
    "search_paper",
    "lookup_citation",
  ]);
  const DISCOVER_ONLY_TOOLS = new Set(["submit_picks"]);
  const tools = getAllTools().filter((t) => {
    if (skipWebSearch && t.name === "web_search") return false;
    if (!parsedPaper && PAPER_PARSED_TOOLS.has(t.name)) return false;
    // Structured-output tools only register for the surface that uses them.
    if (mode !== "discover" && DISCOVER_ONLY_TOOLS.has(t.name)) return false;
    return true;
  });
  const toolContext: ToolContext = {
    paperContext,
    parsedPaper,
    paperTitle,
    arxivId,
    reviewId,
    exaApiKey: trimmedExaKey || undefined,
  };
  const systemPrompt = getSystemPrompt(sourceUrl, mode);

  // Resolve the conversation to send the model. Server-owned path: load it
  // from the DB, append the new user turn, then budget it to the model's
  // context window. Persistence happens AFTER the stream (see below) so the
  // only pre-stream cost is auth + one history read — nothing blocks
  // time-to-first-token. Legacy path: the client supplied the transcript.
  let conversation: TranscriptMessage[];
  let persist: { userId: string; reviewId: string; base: ChatMessage[] } | null =
    null;
  if (isStateful) {
    try {
      // Reuse the user already resolved during metered key resolution to avoid
      // a second session read on the pre-stream path.
      const userId = meterUserId ?? (await requireUserId());
      const history = await store.getMessages(userId, reviewId!);
      const last = history[history.length - 1];
      let base: ChatMessage[];
      if (resume || (last?.role === "user" && last.id === userMessageId)) {
        // Resume (Exa-key decision) or an idempotent retry: the user turn is
        // already stored. Re-run the existing history rather than duplicating.
        base = history;
      } else {
        const userMsg: ChatMessage = {
          id: userMessageId || crypto.randomUUID(),
          role: "user",
          content: userMessage ?? "",
          timestamp: new Date().toISOString(),
        };
        base = [...history, userMsg];
      }
      persist = { userId, reviewId: reviewId!, base };

      // Budget the conversation to fit the model's context window. Storage
      // keeps the full history; this only shapes what's sent to the model.
      const paperBlock = buildPaperBlock(paperContext, parsedPaper) ?? "";
      const overhead =
        estimateTokens(systemPrompt) + estimateTokens(paperBlock) + 2_000;
      const historyBudget =
        OPENROUTER_CONTEXT_WINDOW - 16_384 - overhead - 2_000;
      conversation = fitTranscriptToBudget(
        base,
        Math.max(4_000, historyBudget),
      ).messages;
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err);
      throw err;
    }
  } else {
    conversation = messages!;
  }

  // History hygiene: past assistant turns may contain retired visual fences
  // (```chart / ```mermaid), and the model imitates its own prior output far
  // more reliably than it follows the prompt's ```diagram instruction.
  // Relabel them in the model-facing transcript only — storage keeps the
  // original, and the data stays in context so "redraw it" still works.
  conversation = conversation.map((m) =>
    m.role === "assistant"
      ? {
          ...m,
          content: retireLegacyVisualFences(m.content),
          blocks: m.blocks?.map((b) =>
            b.type === "text_segment"
              ? { ...b, content: retireLegacyVisualFences(b.content) }
              : b,
          ),
        }
      : m,
  );

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Accumulate the assistant turn server-side (server-owned path only) so
      // we can persist it on completion — same step logic the client renders.
      let steps: AgentStep[] = [];
      // Sum real token usage across every tool round for the reconcile below.
      let actualTokens = 0;
      const emit = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* controller may be closed */
        }
        if (persist) steps = processStreamEvent(steps, event);
        if (event.type === "cache_stats") {
          // Cost-weighted: cache reads count at 10% (see meteredTokens).
          // cacheCreationTokens is omitted because it's always 0 for the
          // current provider (OpenRouter/DeepSeek); revisit if an
          // Anthropic-style provider that reports cache-write tokens is ever
          // routed through this event.
          actualTokens += meteredTokens(
            event.inputTokens,
            event.cacheReadTokens,
            event.outputTokens,
          );
        }
      };

      try {
        await runOpenRouterAgentLoop(
          conversation,
          resolvedApiKey,
          systemPrompt,
          paperContext,
          parsedPaper,
          tools,
          toolContext,
          emit,
          body.mode === "discover"
            ? {
                requiredFinalTool: {
                  name: "submit_picks",
                  nudge:
                    "You gathered search results and read candidates but never called submit_picks, so the user would see nothing. Call submit_picks NOW with the 4–6 strongest candidates (fewer if the pool is small) — each with a one-sentence rationale and a canonical URL. Then write the explainer paragraph. Do not ask a question or stop; submit the picks.",
                  maxNudges: 2,
                },
              }
            : // Reading surfaces draw visuals; pin the format rules with
              // recency so old in-conversation examples can't override them.
              { trailingSystemReminder: VISUAL_FORMAT_REMINDER },
        );
      } catch (err) {
        const rateLimited = !!(err as { isRateLimit?: boolean })?.isRateLimit;
        emit(
          rateLimited
            ? {
                type: "error",
                code: "rate_limit",
                message:
                  "You've reached the current usage limit. Add your own OpenRouter key for higher limits.",
              }
            : {
                type: "error",
                message: err instanceof Error ? err.message : "Unknown error",
              },
        );
      }

      // Persist the turn (best-effort) AFTER streaming, so it never delays the
      // first token — this is also where the one Slack notification fires. The
      // user message is always written (the server didn't store it up front);
      // the assistant reply is appended only when the turn produced text, so
      // an Exa-key pause or hard error leaves just the user message and a
      // resume re-runs cleanly.
      if (persist) {
        const content = stepsToContent(steps);
        let finalMessages = persist.base;
        if (content.trim()) {
          const blocks = stepsToBlocks(steps);
          const assistantMsg: ChatMessage = {
            id: assistantMessageId || crypto.randomUUID(),
            role: "assistant",
            content,
            timestamp: new Date().toISOString(),
            ...(blocks.length > 0 ? { blocks } : {}),
          };
          finalMessages = [...persist.base, assistantMsg];
        }
        try {
          await store.setMessages(
            persist.userId,
            persist.reviewId,
            finalMessages,
          );
        } catch (e) {
          // Non-fatal: the client already has the turn on screen. Worst case
          // it's missing on next load; better than failing the request.
          console.error("Failed to persist chat turn:", e);
        }
      }

      // Charge the real usage to the user's buckets (best-effort; the helper
      // swallows its own errors). A heavy turn can push the bucket negative,
      // which gates the next request until it refills.
      if (meter && meterUserId) {
        await charge(meterUserId, actualTokens);
      }

      emit({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
