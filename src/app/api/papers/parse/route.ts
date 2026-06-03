/**
 * Paper parsing endpoint.
 *
 * Takes the raw extracted text of a paper, asks the model to extract a
 * structured representation (sections, references, figures, an L1 summary),
 * and returns the JSON. The browser caches the result by content hash so
 * re-opening the same paper is free.
 */

import { NextRequest } from "next/server";
import { jsonError, parseApiErrorMessage } from "@/lib/api-utils";
import { resolveOpenRouterKey } from "@/server/provider-env";
import { OPENROUTER_BASE_URL, OPENROUTER_MODEL } from "@/lib/openrouter";
import type { ParsedPaper } from "@/lib/review-types";

const OPENROUTER_CHAT_COMPLETIONS_URL = `${OPENROUTER_BASE_URL}/chat/completions`;

interface ParseRequest {
  paperText: string;
  /** Optional per-user OpenRouter key override. Server falls back to env. */
  apiKey?: string;
}

/** ~3M characters ≈ 750k tokens — comfortably above the long-paper threshold. */
const MAX_PAPER_CHARS = 3_000_000;

const PARSE_SYSTEM_PROMPT = `You are an expert academic paper parser. You receive the full text of a paper and return a single, valid JSON object describing its structure.

Output rules — non-negotiable:
- Return ONLY the JSON object. No markdown fences, no commentary, no preamble.
- The JSON must be valid and parseable on the first try.
- Preserve the paper's section hierarchy. Use level 1 for top-level (e.g. "1 Introduction"), 2 for subsections (e.g. "3.2 Architecture"), 3 for deeper.
- Section bodies must be the verbatim text of that section. Do not summarize section bodies.
- The input text contains "[Page N]" markers at every page boundary. ALWAYS populate startPage on each section and page on each figure or table using the most recent [Page N] marker that appears at or before that element. This is essential — downstream UI uses these to scroll the PDF viewer.
- "figures" lists figures only; "tables" lists tables only. Use ids "Figure N" and "Table N" respectively (e.g. "Figure 1", "Table 2"). Do not put tables in "figures" or vice versa.
- The "summary" field IS a summary: 800-1500 words, covering central claim, methods, key results, novelty, limitations. Write this as the L1 paper card a careful reader would want.

JSON schema:
{
  "title": string,
  "abstract": string,
  "sections": Array<{ "heading": string, "level": number, "body": string, "startPage": number }>,
  "references": Array<{ "key": string, "text": string, "doi"?: string, "arxivId"?: string }>,
  "figures": Array<{ "id": string, "caption": string, "page": number }>,
  "tables": Array<{ "id": string, "caption": string, "page": number }>,
  "summary": string
}`;

const PARSE_USER_INSTRUCTION = `Parse the paper below into the JSON schema described in the system prompt. Return ONLY the JSON object — no markdown, no extra text.

<paper>
{{PAPER}}
</paper>`;

export async function POST(req: NextRequest) {
  let body: ParseRequest;
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
      `Paper is too large to parse (${paperText.length.toLocaleString()} chars > ${MAX_PAPER_CHARS.toLocaleString()} cap).`,
      413,
    );
  }

  const resolvedApiKey = resolveOpenRouterKey(apiKey);
  if (!resolvedApiKey) {
    return jsonError("API key is required.", 401);
  }

  const userPrompt = PARSE_USER_INSTRUCTION.replace("{{PAPER}}", paperText);

  try {
    const raw = await callOpenRouter(resolvedApiKey, userPrompt);

    const parsed = extractAndValidateJson(raw);
    if (!parsed) {
      return jsonError(
        "Model returned a response that wasn't valid JSON. Try again or pick a stronger model.",
        502,
      );
    }

    const result: ParsedPaper = {
      title: typeof parsed.title === "string" ? parsed.title : "",
      abstract: typeof parsed.abstract === "string" ? parsed.abstract : "",
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      references: Array.isArray(parsed.references) ? parsed.references : [],
      figures: Array.isArray(parsed.figures) ? parsed.figures : [],
      tables: Array.isArray(parsed.tables) ? parsed.tables : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      parsedAt: new Date().toISOString(),
      parsedWith: { modelId: OPENROUTER_MODEL },
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
/*  OpenRouter call — non-streaming, JSON-mode                         */
/* ------------------------------------------------------------------ */

async function callOpenRouter(
  apiKey: string,
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
        { role: "system", content: PARSE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      // Ask the model to commit to JSON output.
      response_format: { type: "json_object" },
      stream: false,
      // The summary alone is up to ~3000 tokens; sections + refs + figures
      // can push the JSON to 50k+ tokens for long papers.
      max_tokens: 64000,
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
/*  JSON extraction                                                    */
/* ------------------------------------------------------------------ */

/**
 * Models occasionally wrap JSON in markdown fences or add a stray sentence
 * before/after despite the prompt. Be lenient: find the outermost { ... }
 * span and parse that. Returns null if no JSON object is recoverable.
 */
function extractAndValidateJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try direct parse first.
  try {
    const direct = JSON.parse(trimmed);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }

  // Strip markdown code fences if present.
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

  // Last resort: outermost-brace span.
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
