/**
 * Lightweight citation-to-page mapping endpoint.
 *
 * Takes the raw extracted text of a paper (with `[Page N]` markers from
 * pdfjs) and asks the user's chosen model for a small JSON object: each
 * section / figure / table number → the PDF page it first appears on.
 *
 * Runs unconditionally on paper open — short and long alike — so chip
 * click-to-scroll has reliable page numbers without depending on the
 * heavyweight `/api/papers/parse` endpoint or the regex fallback.
 *
 * Uses the user's selected provider+model+key — never hardcodes a model
 * on the platform side. Mirrors the conventions in /api/papers/parse.
 */

import { NextRequest } from "next/server";
import {
  invalidApiProviderMessage,
  isAnthropicMessagesProvider,
  isLocalhostUrl,
  isProvider,
  openAiCompatibleChatCompletionsUrl,
  providerApiErrorLabel,
  type OpenAiCompatibleProvider,
} from "@/lib/ai-providers";
import { jsonError, parseApiErrorMessage } from "@/lib/api-utils";
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

const PAGE_MAP_SYSTEM_PROMPT = `You are a precise data extractor. You receive the full text of an academic paper, annotated with "[Page N]" markers at every page boundary. Your job is to return a small JSON object mapping each numbered section heading, figure caption, and table caption to the page number on which it actually appears.

Critical distinction — the element itself vs. references to it:
- Record the page where the element is PRESENT in the document — i.e. where the section heading is written, where the figure caption "Figure N: …" sits below the figure, or where the table caption "Table N: …" sits with the table.
- Ignore in-text references that merely MENTION the element. Phrases like "as shown in Section 3.2", "see Figure 1", "we describe this in §4", "(cf. Table 2)", "results from 3.1 demonstrate…" are pointers TO the element, not the element itself. Do not record their pages.
- If an element is referenced many times across the paper but you cannot find its actual heading or caption, omit it. Do not fall back to a reference's page.

Grounding requirement — for every entry you emit, also copy the literal "[Page N]" marker that immediately precedes the element in the source text. The marker number must equal the page number you report. This forces you to ground your answer in a specific span of the input rather than estimating page positions.

Worked example — DIFFERENT shapes, same logic:

Input excerpt:
"… we report per-class accuracy in Table 2 below, which compares all baselines …
[Page 5]
Table 2: Per-class accuracy on the validation split. Our model attains 91.4% …"

The phrase "in Table 2 below" is on page 4 — but it is a reference, not the table caption. The actual caption "Table 2: Per-class accuracy …" sits after the [Page 5] marker.

Correct output for this snippet:
{ "tables": { "2": { "page": 5, "marker": "[Page 5]" } } }

Wrong outputs to avoid:
- { "tables": { "2": { "page": 4, "marker": "[Page 4]" } } }   ← picked up the in-text reference
- { "tables": { "2": { "page": 5, "marker": "[Page 4]" } } }   ← page and marker disagree

Output rules — non-negotiable:
- Return ONLY the JSON object. No markdown fences, no commentary.
- The JSON must be valid and parseable on the first try.
- For sections: keys are the section number exactly as it appears at the start of the heading (e.g. "1", "3.2", "A.1"). Skip unnumbered headings like "Abstract" or "References".
- For figures: keys are the figure number as a string (e.g. "1", "2"). Use the page where the caption is written.
- For tables: keys are the table number as a string. Use the page where the caption is written.
- For every entry, "page" is an integer and "marker" is the literal "[Page N]" string from the input, with N equal to "page".
- Skip any item you can't locate confidently. It is better to omit an entry than to guess.

JSON schema:
{
  "sections": { "<num>": { "page": <integer>, "marker": "[Page <integer>]" } },
  "figures":  { "<num>": { "page": <integer>, "marker": "[Page <integer>]" } },
  "tables":   { "<num>": { "page": <integer>, "marker": "[Page <integer>]" } }
}`;

const PAGE_MAP_USER_INSTRUCTION = `Extract the page-mapping JSON described in the system prompt for the paper below. Return ONLY the JSON object.

<paper>
{{PAPER}}
</paper>`;

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

  const isLocalInferenceCall =
    isInferenceProviderType(provider) &&
    !!effectiveBaseUrl &&
    isLocalhostUrl(effectiveBaseUrl);
  if (!effectiveApiKey && !isLocalInferenceCall) {
    return jsonError("API key is required.", 401);
  }
  if (isInferenceProviderType(provider) && !effectiveBaseUrl) {
    return jsonError(
      "apiBaseUrl is required for OpenAI-compatible providers.",
      400,
    );
  }

  const userPrompt = PAGE_MAP_USER_INSTRUCTION.replace("{{PAPER}}", paperText);

  try {
    const raw = isAnthropicMessagesProvider(provider)
      ? await callAnthropic(model, effectiveApiKey, userPrompt)
      : await callOpenAICompatible(
          model,
          effectiveApiKey,
          userPrompt,
          provider as OpenAiCompatibleProvider,
          provider === "openai_compatible" ? effectiveBaseUrl : undefined,
        );

    const parsed = extractAndValidateJson(raw);
    if (!parsed) {
      return jsonError(
        "Model returned a response that wasn't valid JSON. Try again or pick a stronger model.",
        502,
      );
    }

    const result: PageMap = {
      sections: coerceNumberMap(parsed.sections),
      figures: coerceNumberMap(parsed.figures),
      tables: coerceNumberMap(parsed.tables),
    };

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
}

/* ------------------------------------------------------------------ */
/*  Provider calls                                                     */
/* ------------------------------------------------------------------ */

async function callAnthropic(
  model: string,
  apiKey: string,
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
      system: PAGE_MAP_SYSTEM_PROMPT,
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
        { role: "system", content: PAGE_MAP_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      stream: false,
      max_tokens: 8000,
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
 * Accepts either the rich shape `{ <num>: { page, marker } }` (current
 * prompt) or the flat shape `{ <num>: <page> }` (older prompt / model
 * stragglers). Drops entries where the marker contradicts the page —
 * those are exactly the cases where the model "drifted".
 */
function coerceNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const page = extractPage(v);
    if (page != null) out[String(k)] = page;
  }
  return out;
}

function extractPage(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;
  }
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    const pageRaw = obj.page;
    const page =
      typeof pageRaw === "number"
        ? pageRaw
        : typeof pageRaw === "string"
          ? Number(pageRaw)
          : NaN;
    if (!Number.isFinite(page) || page <= 0) return null;
    const truncated = Math.trunc(page);
    // If the model included a marker, validate it matches the page. A
    // drift between page and marker is the failure mode this whole
    // grounding requirement exists to catch — drop the entry.
    if (typeof obj.marker === "string") {
      const m = obj.marker.match(/\[Page\s+(\d+)\]/i);
      if (!m || parseInt(m[1], 10) !== truncated) return null;
    }
    return truncated;
  }
  return null;
}
