/**
 * Provider-agnostic paper parsing endpoint.
 *
 * Takes the raw extracted text of a paper, asks the user's chosen model to
 * extract a structured representation (sections, references, figures, an
 * L1 summary), and returns the JSON. The browser caches the result by
 * content hash so re-opening the same paper is free.
 *
 * Uses the user's selected provider+model+key — never hardcodes a model
 * on the platform side. Mirrors the conventions in /api/generate.
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
import type { ParsedPaper } from "@/lib/review-types";

interface ParseRequest {
  paperText: string;
  model: string;
  provider: Provider;
  apiKey: string;
  apiBaseUrl?: string;
  /** Whether the OpenAI-compatible endpoint supports streaming. Default: true. */
  supportsStreaming?: boolean;
}

/** ~3M characters ≈ 750k tokens — comfortably above the long-paper threshold. */
const MAX_PAPER_CHARS = 3_000_000;

const PARSE_SYSTEM_PROMPT = `You are an expert academic paper parser. You receive the full text of a paper and return a single, valid JSON object describing its structure.

Output rules — non-negotiable:
- Return ONLY the JSON object. No markdown fences, no commentary, no preamble.
- The JSON must be valid and parseable on the first try.
- Preserve the paper's section hierarchy. Use level 1 for top-level (e.g. "1 Introduction"), 2 for subsections (e.g. "3.2 Architecture"), 3 for deeper.
- Section bodies must be the verbatim text of that section. Do not summarize section bodies.
- The input text contains "[Page N]" markers at every page boundary. ALWAYS populate startPage on each section and page on each figure using the most recent [Page N] marker that appears at or before that element. This is essential — downstream UI uses these to scroll the PDF viewer.
- The "summary" field IS a summary: 800-1500 words, covering central claim, methods, key results, novelty, limitations. Write this as the L1 paper card a careful reader would want.

JSON schema:
{
  "title": string,
  "abstract": string,
  "sections": Array<{ "heading": string, "level": number, "body": string, "startPage": number }>,
  "references": Array<{ "key": string, "text": string, "doi"?: string, "arxivId"?: string }>,
  "figures": Array<{ "id": string, "caption": string, "page": number }>,
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
      `Paper is too large to parse (${paperText.length.toLocaleString()} chars > ${MAX_PAPER_CHARS.toLocaleString()} cap).`,
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

  const userPrompt = PARSE_USER_INSTRUCTION.replace("{{PAPER}}", paperText);

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

    const result: ParsedPaper = {
      title: typeof parsed.title === "string" ? parsed.title : "",
      abstract: typeof parsed.abstract === "string" ? parsed.abstract : "",
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      references: Array.isArray(parsed.references) ? parsed.references : [],
      figures: Array.isArray(parsed.figures) ? parsed.figures : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      parsedAt: new Date().toISOString(),
      parsedWith: { provider, modelId: model },
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
/*  Provider calls — non-streaming, JSON-mode where supported          */
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
      // The summary alone is up to ~3000 tokens; sections + refs + figures
      // can easily push the JSON to 50k+ tokens for long papers. Use the
      // model's full output budget where available.
      max_tokens: 64000,
      system: PARSE_SYSTEM_PROMPT,
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
        { role: "system", content: PARSE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      // Ask the model to commit to JSON output. OpenAI/xAI honor this;
      // local servers either honor it or ignore it (in which case the
      // system prompt's instructions still steer the response).
      response_format: { type: "json_object" },
      stream: false,
      max_tokens: 64000,
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
