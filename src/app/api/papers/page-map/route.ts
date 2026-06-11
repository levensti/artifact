/**
 * Lightweight citation-to-page mapping endpoint.
 *
 * Takes the raw extracted text of a paper (with `[Page N]` markers from
 * pdfjs), splits it into per-page chunks, and fires one small LLM call
 * per page in parallel. Each call returns the numbered sections, figures,
 * and tables whose heading/caption text actually sits on that page. The
 * server then merges results into a single { sections, figures, tables }
 * map. Duplicates prefer the page whose text has the stronger heading or
 * caption shape, falling back to the lowest page number on ties.
 *
 * Per-page fan-out keeps each prompt tiny and removes the "find the page"
 * burden from the model (the page is an input, not something to discover),
 * which both lowers wall-clock latency and removes the marker-drift
 * failure mode the single-call version had to guard against.
 */

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { jsonError, parseApiErrorMessage } from "@/lib/api-utils";
import { resolveOpenRouterKey } from "@/server/provider-env";
import { OPENROUTER_BASE_URL, OPENROUTER_MODEL } from "@/lib/openrouter";
import type { PageMap } from "@/lib/review-types";

const OPENROUTER_CHAT_COMPLETIONS_URL = `${OPENROUTER_BASE_URL}/chat/completions`;

interface PageMapRequest {
  paperText: string;
  /** Optional per-user OpenRouter key override. Server falls back to env. */
  apiKey?: string;
}

const MAX_PAPER_CHARS = 3_000_000;

const PAGE_MAP_SYSTEM_PROMPT = `You are extracting structured metadata from a single page of an academic paper.

List every numbered element whose heading or caption is written on this page:
- Numbered section headings (e.g. "1 Introduction", "3.2 Methods", "A.1 Proof of Theorem 1").
- Figure captions (e.g. "Figure 2: Per-class accuracy on the validation set.").
- Table captions (e.g. "Table 1: Hyperparameters used across experiments.").

Only record an element if its heading or caption text actually appears on this page. In-text references like "as shown in Figure 3", "see Section 4", "(cf. Table 2)" are pointers to elements that live elsewhere — ignore them. If a section continues from a prior page without a new heading appearing here, do not record it.

Worked example. If the page contains "we report per-class accuracy in Table 2 below, which compares all baselines" but the caption "Table 2: …" itself is not on this page, do NOT record table 2 — that's an in-text reference, not the caption. Record table 2 only on the page where the caption text "Table 2: …" actually appears.

Skip unnumbered headings such as "Abstract", "References", "Acknowledgements". When in doubt, omit — it is better to leave an element out than to guess.

For every item you record, copy a short exact evidence snippet from this page:
- For sections, copy the section heading text.
- For figures and tables, copy the beginning of the caption.
- Keep snippets short, usually 5-20 words. Do not paraphrase.

Return ONLY a JSON object with this exact shape:
{
  "sections": [{ "num": "<num>", "evidence": "<exact heading snippet>" }, ...],
  "figures": [{ "num": "<num>", "evidence": "<exact caption snippet>" }, ...],
  "tables": [{ "num": "<num>", "evidence": "<exact caption snippet>" }, ...]
}

Each entry is the element's number as a string (e.g. "1", "3.2", "A.1"). Use an empty array for any category with nothing on this page. No prose, no markdown fences — just the JSON.`;

const PAGE_MAP_USER_INSTRUCTION = `Page text:

<page>
{{PAGE}}
</page>`;

const TITLE_SYSTEM_PROMPT = `You are extracting the title of an academic paper from its first page.

Return the paper's title copied verbatim from the page text. Strip stray line breaks the PDF extractor may have inserted mid-title, but do not paraphrase, shorten, or invent. If you cannot identify a clear title on this page, return an empty string — never guess.

Return ONLY a JSON object with this exact shape:
{ "title": "<string>" }

No prose, no markdown fences — just the JSON.`;

const TITLE_USER_INSTRUCTION = `First page text:

<page>
{{PAGE}}
</page>`;

export async function POST(req: NextRequest) {
  let body: PageMapRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { paperText, apiKey } = body;

  if (!paperText || typeof paperText !== "string") {
    return jsonError("paperText is required.", 400);
  }
  if (paperText.length > MAX_PAPER_CHARS) {
    return jsonError(
      `Paper is too large to map (${paperText.length.toLocaleString()} chars > ${MAX_PAPER_CHARS.toLocaleString()} cap).`,
      413,
    );
  }

  const resolvedApiKey = resolveOpenRouterKey(apiKey);
  if (!resolvedApiKey) {
    return jsonError("API key is required.", 401);
  }

  const pages = splitByPage(paperText);
  // Debug: server-side page-map build size.
  // if (process.env.NODE_ENV === "development") {
  //   console.log(
  //     `[page-map] building map for ${paperText.length.toLocaleString()} chars across ${pages.length.toLocaleString()} pages`,
  //   );
  // }

  const dispatch = (systemPrompt: string, userPrompt: string): Promise<string> =>
    callOpenRouter(resolvedApiKey, systemPrompt, userPrompt);

  const callOne = (pageText: string): Promise<string> =>
    dispatch(
      PAGE_MAP_SYSTEM_PROMPT,
      PAGE_MAP_USER_INSTRUCTION.replace("{{PAGE}}", pageText),
    );

  // Title runs as a separate one-off call against page 1. Kept independent
  // from the per-page mapping so a title failure can't poison the page map
  // and vice versa — they're merged at the end.
  const firstPage = pages[0];
  const titleCall: Promise<string | null> = firstPage
    ? dispatch(
        TITLE_SYSTEM_PROMPT,
        TITLE_USER_INSTRUCTION.replace("{{PAGE}}", firstPage.text),
      ).catch(() => null)
    : Promise.resolve(null);

  // Stream NDJSON progress events. The client uses these to drive a
  // determinate loading bar; total + per-page completions arrive as
  // separate lines, the final line carries the merged PageMap.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const total = pages.length;
      const write = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      write({ type: "init", total });

      const anchors: NonNullable<PageMap["anchors"]> = {
        sections: {},
        figures: {},
        tables: {},
      };
      const result: PageMap = {
        sections: {},
        figures: {},
        tables: {},
        anchors,
      };
      const sectionScores: Record<string, number> = {};
      const figureScores: Record<string, number> = {};
      const tableScores: Record<string, number> = {};
      let done = 0;
      let firstError: string | null = null;

      await Promise.all(
        pages.map(async (p) => {
          try {
            const raw = await callOne(p.text);
            const parsed = extractAndValidateJson(raw);
            if (parsed) {
              mergeSectionList(
                result.sections,
                anchors.sections,
                sectionScores,
                parsed.sections,
                p.page,
                p.text,
              );
              mergeCaptionList(
                result.figures,
                anchors.figures,
                figureScores,
                parsed.figures,
                p.page,
                p.text,
                "figure",
              );
              mergeCaptionList(
                result.tables,
                anchors.tables,
                tableScores,
                parsed.tables,
                p.page,
                p.text,
                "table",
              );
            }
          } catch (e) {
            if (!firstError) {
              firstError = e instanceof Error ? e.message : "Unknown error";
            }
          }
          done++;
          write({ type: "progress", done, total });
        }),
      );

      const titleRaw = await titleCall;
      if (titleRaw) {
        const titleParsed = extractAndValidateJson(titleRaw);
        const t =
          titleParsed && typeof titleParsed.title === "string"
            ? titleParsed.title.trim()
            : "";
        if (t) result.title = t;
      }

      const anyResults =
        Object.keys(result.sections).length +
          Object.keys(result.figures).length +
          Object.keys(result.tables).length >
        0;
      if (firstError && !anyResults) {
        write({ type: "error", error: firstError });
      } else {
        // Debug: inspect final merged page map.
        // if (process.env.NODE_ENV === "development") {
        //   console.log("[page-map] result", result);
        // }
        write({ type: "result", map: result });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      // Tell reverse proxies (nginx, etc.) not to buffer — ensures each
      // per-page progress event reaches the client immediately rather than
      // batching until the response closes.
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Split paper text by pdfjs `[Page N]` markers. Returns one entry per
 * page containing only that page's text. If no markers are present
 * (unusual), treats the whole text as page 1.
 */
function splitByPage(paperText: string): Array<{ page: number; text: string }> {
  const re = /\[Page\s+(\d+)\]/g;
  const markers: Array<{ page: number; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(paperText)) !== null) {
    markers.push({
      page: parseInt(m[1], 10),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  if (markers.length === 0) {
    const t = paperText.trim();
    return t ? [{ page: 1, text: t }] : [];
  }
  const out: Array<{ page: number; text: string }> = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].end;
    const end = i + 1 < markers.length ? markers[i + 1].start : paperText.length;
    const text = paperText.slice(start, end).trim();
    if (text) out.push({ page: markers[i].page, text });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  OpenRouter call                                                    */
/* ------------------------------------------------------------------ */

async function callOpenRouter(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      stream: false,
      // Output is just three small dictionaries — a few hundred tokens is
      // plenty for even a 50-section paper.
      max_tokens: 8000,
    }),
  });

  if (!response.ok) throw await parseError(response);

  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

async function parseError(response: Response) {
  const errorText = await response.text();
  const fallback = `OpenRouter API error: ${response.status}`;
  return new Error(parseApiErrorMessage(errorText, fallback));
}

/* ------------------------------------------------------------------ */
/*  JSON extraction + validation                                       */
/* ------------------------------------------------------------------ */

function extractAndValidateJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const direct = JSON.parse(trimmed);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const fenced = JSON.parse(fenceMatch[1].trim());
      if (fenced && typeof fenced === "object" && !Array.isArray(fenced)) {
        return fenced as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      const span = JSON.parse(trimmed.slice(first, last + 1));
      if (span && typeof span === "object" && !Array.isArray(span)) {
        return span as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }

  return null;
}

/**
 * Merge section output. Duplicate section candidates prefer pages where the
 * number appears in a stronger heading shape, then earliest page.
 */
function mergeSectionList(
  target: Record<string, number>,
  anchors: Record<string, string>,
  scores: Record<string, number>,
  value: unknown,
  page: number,
  pageText: string,
): void {
  const entries = listEntries(value);
  for (const entry of entries) {
    const score = sectionHeadingScore(entry.num, pageText);
    const currentScore = scores[entry.num] ?? -1;
    const currentPage = target[entry.num];
    const shouldReplace =
      currentPage == null ||
      score > currentScore ||
      (score === currentScore && page < currentPage);
    if (shouldReplace) {
      target[entry.num] = page;
      scores[entry.num] = score;
      if (entry.evidence) anchors[entry.num] = entry.evidence;
      else delete anchors[entry.num];
    }
  }
}

type PageMapEntry = {
  num: string;
  evidence?: string;
};

function mergeCaptionList(
  target: Record<string, number>,
  anchors: Record<string, string>,
  scores: Record<string, number>,
  value: unknown,
  page: number,
  pageText: string,
  kind: "figure" | "table",
): void {
  const entries = listEntries(value);
  for (const entry of entries) {
    const score = captionShapeScore(kind, entry.num, pageText);
    const currentScore = scores[entry.num] ?? -1;
    const currentPage = target[entry.num];
    const shouldReplace =
      currentPage == null ||
      score > currentScore ||
      (score === currentScore && page < currentPage);
    if (shouldReplace) {
      target[entry.num] = page;
      scores[entry.num] = score;
      if (entry.evidence) anchors[entry.num] = entry.evidence;
      else delete anchors[entry.num];
    }
  }
}

function listEntries(value: unknown): PageMapEntry[] {
  const entries: PageMapEntry[] = [];
  if (Array.isArray(value)) {
    for (const v of value) {
      const entry = mapEntry(v);
      if (entry) entries.push(entry);
    }
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      const trimmed = k.trim();
      if (trimmed) entries.push({ num: trimmed });
    }
  }
  return entries;
}

function mapEntry(v: unknown): PageMapEntry | null {
  if (typeof v === "string") return v.trim() ? { num: v.trim() } : null;
  if (typeof v === "number" && Number.isFinite(v)) return { num: String(v) };
  if (v && typeof v === "object" && "num" in v) {
    const raw = v as { num?: unknown; evidence?: unknown };
    const num =
      typeof raw.num === "string"
        ? raw.num.trim()
        : typeof raw.num === "number" && Number.isFinite(raw.num)
          ? String(raw.num)
          : "";
    if (!num) return null;
    const evidence =
      typeof raw.evidence === "string" ? raw.evidence.trim() : "";
    return evidence ? { num, evidence } : { num };
  }
  return null;
}

function captionShapeScore(
  kind: "figure" | "table",
  num: string,
  pageText: string,
): number {
  const label =
    kind === "figure" ? String.raw`(?:Fig(?:ure)?\.?)` : String.raw`(?:Table|Tab\.)`;
  const numPattern = escapeRegex(num).replace(/\\\./g, String.raw`\s*\.\s*`);
  const prefix = String.raw`(?:^|[\s(\[{])${label}\s*${numPattern}`;
  let best = 0;

  best = Math.max(
    best,
    bestCaptionMatchScore(
      new RegExp(`${prefix}\\s*[:：]`, "gi"),
      pageText,
      400,
    ),
  );
  best = Math.max(
    best,
    bestCaptionMatchScore(
      new RegExp(`${prefix}\\s*(?:[.．]|[-–—])\\s+\\S`, "gi"),
      pageText,
      300,
    ),
  );
  best = Math.max(
    best,
    bestCaptionMatchScore(
      new RegExp(`${prefix}\\s+[A-Z][A-Za-z0-9]`, "gi"),
      pageText,
      200,
    ),
  );
  best = Math.max(
    best,
    bestCaptionMatchScore(new RegExp(prefix, "gi"), pageText, 50),
  );
  return best;
}

const CAPTION_REFERENCE_LEAD_INS = [
  /\bas\s+shown\s+in\s*$/i,
  /\bas\s+illustrated\s+in\s*$/i,
  /\bshown\s+in\s*$/i,
  /\billustrated\s+in\s*$/i,
  /\bsee\s+also\s*$/i,
  /\bsee\s*$/i,
  /\bdescribed\s+in\s*$/i,
  /\bpresented\s+in\s*$/i,
  /\breported\s+in\s*$/i,
  /\bsummarized\s+in\s*$/i,
  /\baccording\s+to\s*$/i,
  /\bcompared\s+(?:with|to)\s*$/i,
  /\bfrom\s*$/i,
  /\bin\s*$/i,
  /\bof\s*$/i,
];

function bestCaptionMatchScore(
  re: RegExp,
  pageText: string,
  baseScore: number,
): number {
  let best = 0;
  for (const match of pageText.matchAll(re)) {
    const index = match.index ?? 0;
    const before = pageText.slice(Math.max(0, index - 80), index);
    const penalty = CAPTION_REFERENCE_LEAD_INS.some((leadIn) =>
      leadIn.test(before),
    )
      ? 250
      : 0;
    best = Math.max(best, Math.max(0, baseScore - penalty));
  }
  return best;
}

function sectionHeadingScore(num: string, pageText: string): number {
  const numPattern = escapeRegex(num).replace(/\\\./g, String.raw`\s*\.\s*`);
  const title = String.raw`[A-Z][A-Za-z0-9,;:'"()\-–—/]+`;
  const words = String.raw`${title}(?:\s+${title}){0,10}`;

  if (new RegExp(String.raw`(?:^|\n)\s*${numPattern}\s+${words}`, "i").test(pageText)) {
    return 400;
  }
  if (
    new RegExp(
      String.raw`(?:^|[\s([{])(?:Section|Sec\.?)\s+${numPattern}\s*[:.\-–—]?\s+${words}`,
      "i",
    ).test(pageText)
  ) {
    return 300;
  }
  if (
    new RegExp(
      String.raw`(?:^|[\s([{])${numPattern}\s*[:.\-–—]\s+${words}`,
      "i",
    ).test(pageText)
  ) {
    return 250;
  }
  if (new RegExp(String.raw`(?:^|[\s([{])${numPattern}(?![\d.])`, "i").test(pageText)) {
    return 50;
  }
  return 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
