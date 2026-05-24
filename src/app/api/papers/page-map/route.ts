/**
 * Lightweight citation-to-page mapping endpoint.
 *
 * Takes the raw extracted text of a paper (with `[Page N]` markers from
 * pdfjs), splits it into per-page chunks, and fires one small LLM call
 * per page in parallel. Each call returns the numbered sections, figures,
 * and tables whose heading/caption text actually sits on that page. The
 * server then merges results into a single { sections, figures, tables }
 * map, keeping the lowest page number per element number.
 *
 * Per-page fan-out keeps each prompt tiny and removes the "find the page"
 * burden from the model (the page is an input, not something to discover),
 * which both lowers wall-clock latency and removes the marker-drift
 * failure mode the single-call version had to guard against.
 *
 * Uses the user's selected provider+model+key — never hardcodes a model
 * on the platform side. Mirrors the conventions in /api/papers/parse.
 */

import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import {
  invalidApiProviderMessage,
  isAnthropicMessagesProvider,
  isLocalhostUrl,
  isProvider,
  openAiCompatibleChatCompletionsUrl,
  openAiMaxTokensField,
  providerApiErrorLabel,
  type OpenAiCompatibleProvider,
} from "@/lib/ai-providers";
import { jsonError, parseApiErrorMessage } from "@/lib/api-utils";
import { resolveServerApiKey } from "@/server/provider-env";
import { isInferenceProviderType, type Provider } from "@/lib/models";
import type { PageMap } from "@/lib/review-types";

interface PageMapRequest {
  paperText: string;
  model: string;
  provider: Provider;
  apiKey: string;
  apiBaseUrl?: string;
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

Return ONLY a JSON object with this exact shape:
{ "sections": ["<num>", ...], "figures": ["<num>", ...], "tables": ["<num>", ...] }

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

  const { paperText, model, provider, apiKey, apiBaseUrl } = body;

  if (!isProvider(provider)) {
    return jsonError(invalidApiProviderMessage(), 400);
  }
  if (!model || typeof model !== "string") {
    return jsonError("Model ID is required.", 400);
  }
  if (!paperText || typeof paperText !== "string") {
    return jsonError("paperText is required.", 400);
  }
  if (paperText.length > MAX_PAPER_CHARS) {
    return jsonError(
      `Paper is too large to map (${paperText.length.toLocaleString()} chars > ${MAX_PAPER_CHARS.toLocaleString()} cap).`,
      413,
    );
  }

  const effectiveApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const effectiveBaseUrl =
    typeof apiBaseUrl === "string" ? apiBaseUrl.trim() : "";

  // Built-in providers fall back to the platform key; inference providers
  // keep their existing (key or localhost) behavior unchanged.
  const resolvedApiKey = isInferenceProviderType(provider)
    ? effectiveApiKey
    : resolveServerApiKey(provider, effectiveApiKey) ?? "";

  const isLocalInferenceCall =
    isInferenceProviderType(provider) &&
    !!effectiveBaseUrl &&
    isLocalhostUrl(effectiveBaseUrl);
  if (!resolvedApiKey && !isLocalInferenceCall) {
    return jsonError("API key is required.", 401);
  }
  if (isInferenceProviderType(provider) && !effectiveBaseUrl) {
    return jsonError(
      "apiBaseUrl is required for OpenAI-compatible providers.",
      400,
    );
  }

  const pages = splitByPage(paperText);

  const dispatch = async (
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> => {
    return isAnthropicMessagesProvider(provider)
      ? callAnthropic(model, resolvedApiKey, systemPrompt, userPrompt)
      : callOpenAICompatible(
          model,
          resolvedApiKey,
          systemPrompt,
          userPrompt,
          provider as OpenAiCompatibleProvider,
          provider === "openai_compatible" ? effectiveBaseUrl : undefined,
        );
  };

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

      const result: PageMap = { sections: {}, figures: {}, tables: {} };
      let done = 0;
      let firstError: string | null = null;

      await Promise.all(
        pages.map(async (p) => {
          try {
            const raw = await callOne(p.text);
            const parsed = extractAndValidateJson(raw);
            if (parsed) {
              mergeList(result.sections, parsed.sections, p.page);
              mergeList(result.figures, parsed.figures, p.page);
              mergeList(result.tables, parsed.tables, p.page);
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
/*  Provider calls                                                     */
/* ------------------------------------------------------------------ */

async function callAnthropic(
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      // Output is just three small dictionaries — a few hundred tokens is
      // plenty for even a 50-section paper.
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      stream: false,
    }),
  });

  if (!response.ok) throw await parseError(response, "Anthropic");

  const data = await response.json();
  return data?.content?.[0]?.text ?? "";
}

async function callOpenAICompatible(
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  provider: OpenAiCompatibleProvider,
  customOpenAiBaseUrl?: string,
): Promise<string> {
  const baseUrl = openAiCompatibleChatCompletionsUrl(
    provider,
    customOpenAiBaseUrl,
  );

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      stream: false,
      ...openAiMaxTokensField(model, 8000),
      // Page mapping is mechanical extraction — skip the reasoning pass on
      // models that support it (OpenAI o-series/gpt-5, xAI Grok reasoning).
      // Non-reasoning models and most openai-compatible servers ignore this.
      reasoning_effort: "low",
    }),
  });

  if (!response.ok) {
    throw await parseError(response, providerApiErrorLabel(provider));
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

async function parseError(response: Response, providerLabel: string) {
  const errorText = await response.text();
  const fallback = `${providerLabel} API error: ${response.status}`;
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
 * Merge the per-page model output into `target`. Accepts the expected
 * `["1", "3.2", ...]` array shape; also tolerates an object shape (some
 * models return `{ "1": ..., "3.2": ... }` despite the prompt). Keeps
 * the lowest page seen per key — relevant when a caption straddles a
 * page boundary and shows up in two per-page responses.
 */
function mergeList(
  target: Record<string, number>,
  value: unknown,
  page: number,
): void {
  const keys: string[] = [];
  if (Array.isArray(value)) {
    for (const v of value) {
      const k = stringKey(v);
      if (k) keys.push(k);
    }
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      const trimmed = k.trim();
      if (trimmed) keys.push(trimmed);
    }
  }
  for (const k of keys) {
    if (target[k] == null || page < target[k]) target[k] = page;
  }
}

function stringKey(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
