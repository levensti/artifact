import { NextRequest, NextResponse } from "next/server";
import { isInferenceProviderType } from "@/lib/models";
import { parseApiErrorMessage } from "@/lib/api-utils";
import {
  isLocalhostUrl,
  isProvider,
  normalizeOpenAiCompatibleBase,
  openAiCompatibleModelsListUrl,
  type OpenAiCompatibleProvider,
} from "@/lib/ai-providers";
interface ModelsRequest {
  provider: unknown;
  apiKey?: unknown;
  apiBaseUrl?: unknown;
}

interface ModelOption {
  id: string;
  label: string;
  /** Unix epoch seconds when the provider published this model. */
  created?: number;
}

/**
 * OpenAI's `/v1/models` lists every artifact the key has access to —
 * embeddings, audio, image generation, moderation, realtime, etc. We
 * surface only chat-completions-capable models in the picker.
 *
 * The filter is token-based: split the model ID on `-` and `/`, then
 * reject if any segment matches a non-chat modality keyword. This
 * catches both prefixed (`whisper-1`) and infixed (`gpt-4o-mini-tts`)
 * variant indicators, which OpenAI mixes freely. Substring matching
 * would over-trigger (`instruct` clashes legitimate community models
 * via openai-compatible endpoints), and prefix-only matching misses
 * suffix variants — segment matching is the sweet spot.
 */
const OPENAI_NON_CHAT_TOKENS = new Set<string>([
  "embedding",
  "embed",
  "whisper",
  "tts",
  "transcribe",
  "audio",
  "image",
  "moderation",
  "search",
  "realtime",
  "codex",
  "davinci",
  "babbage",
  "curie",
  "ada",
]);

function modelIdSegments(id: string): string[] {
  return id.toLowerCase().split(/[-/]/);
}

function looksLikeChatModel(id: string): boolean {
  // Restrict to OpenAI's chat families. New ones (gpt-5, o5, etc.)
  // will continue to fit these prefixes; truly novel families would
  // need an explicit add here, which is fine — they're rare events.
  if (
    !id.startsWith("gpt") &&
    !/^o\d/.test(id) &&
    !id.startsWith("chatgpt")
  ) {
    return false;
  }
  for (const seg of modelIdSegments(id)) {
    if (OPENAI_NON_CHAT_TOKENS.has(seg)) return false;
  }
  // dall-e splits into ["dall", "e"] which neither alone is a token,
  // so handle it as a substring.
  if (/dall-?e/.test(id)) return false;
  // Legacy completions endpoint, not chat — only OpenAI ships this id.
  if (id === "gpt-3.5-turbo-instruct" || id.startsWith("gpt-3.5-turbo-instruct-")) {
    return false;
  }
  return true;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  let body: ModelsRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { provider, apiKey, apiBaseUrl } = body;

  if (!isProvider(provider)) {
    return jsonError("Invalid provider.", 400);
  }

  const effectiveKey =
    typeof apiKey === "string" ? apiKey.trim() : "";
  const effectiveBase =
    typeof apiBaseUrl === "string" ? apiBaseUrl.trim() : undefined;

  // OpenAI-compatible providers may be unauthenticated (localhost Ollama, or
  // a tunnel fronting one). If the upstream actually requires a key, it will
  // 401 and we surface that error — better than blocking valid setups here.
  if (!effectiveKey && !isInferenceProviderType(provider)) {
    return jsonError("API key is required.", 401);
  }
  if (isInferenceProviderType(provider) && !effectiveBase) {
    return jsonError(
      "apiBaseUrl is required for OpenAI-compatible providers.",
      400,
    );
  }

  try {
    if (provider === "openai") {
      return NextResponse.json({ models: await fetchOpenAIModels(effectiveKey) });
    }
    if (provider === "anthropic") {
      return NextResponse.json({
        models: await fetchAnthropicModels(effectiveKey),
      });
    }
    if (provider === "openai_compatible") {
      return NextResponse.json({
        models: await fetchOpenAICompatibleModels(
          effectiveKey,
          effectiveBase ?? "",
        ),
      });
    }
    return NextResponse.json({ models: await fetchXAIModels(effectiveKey) });
  } catch (err) {
    const rawMessage =
      err instanceof Error ? err.message : "Failed to load model list";
    const message = rewriteLocalhostFetchError(rawMessage, effectiveBase);
    return jsonError(message, 502);
  }
}

/**
 * When fetching from a localhost URL fails with a connection error, the raw
 * "fetch failed" / "ECONNREFUSED" message isn't actionable. Rewrite to point
 * the user at the obvious cause: their local LLM server isn't running.
 */
function rewriteLocalhostFetchError(
  message: string,
  baseUrl: string | undefined,
): string {
  if (!baseUrl) return message;
  let normalized: string;
  try {
    normalized = normalizeOpenAiCompatibleBase(baseUrl);
  } catch {
    return message;
  }
  if (!isLocalhostUrl(normalized)) return message;
  const looksLikeConnError =
    /econnrefused|fetch failed|networkerror|enotfound|connection refused/i.test(
      message,
    );
  if (!looksLikeConnError) return message;
  return `Cannot reach local LLM server at ${normalized}. Is it running?`;
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const data = await response.json();
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .filter(
      (m: { id?: unknown }): m is { id: string; created?: number } =>
        typeof m.id === "string" && looksLikeChatModel(m.id),
    )
    .map(
      (m: { id: string; created?: number }): ModelOption => ({
        id: m.id,
        label: m.id,
        created: typeof m.created === "number" ? m.created : undefined,
      }),
    );
}

async function fetchOpenAICompatibleModels(
  apiKey: string,
  baseUrl: string,
): Promise<ModelOption[]> {
  const listUrl = openAiCompatibleModelsListUrl(
    "openai_compatible" as OpenAiCompatibleProvider,
    baseUrl,
  );
  const response = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      parseApiErrorMessage(
        errText,
        `OpenAI-compatible API error: ${response.status} (${listUrl})`,
      ),
    );
  }
  const data = (await response.json()) as {
    data?: unknown;
    models?: unknown;
  };
  const rawList = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : [];
  const models = rawList;
  return models
    .filter(
      (m: { id?: unknown }): m is { id: string; created?: number } =>
        typeof m.id === "string",
    )
    .map(
      (m: { id: string; created?: number }): ModelOption => ({
        id: m.id,
        label: m.id,
        created: typeof m.created === "number" ? m.created : undefined,
      }),
    );
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
  const data = await response.json();
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .filter(
      (m: { id?: unknown }): m is {
        id: string;
        display_name?: string;
        created_at?: string;
      } => typeof m.id === "string" && m.id.length > 0,
    )
    .map(
      (m: {
        id: string;
        display_name?: string;
        created_at?: string;
      }): ModelOption => {
        // Anthropic returns ISO 8601 (e.g. "2024-10-22T00:00:00Z").
        // Convert to Unix seconds for parity with the other providers.
        let created: number | undefined;
        if (typeof m.created_at === "string") {
          const ts = Date.parse(m.created_at);
          if (Number.isFinite(ts)) created = Math.floor(ts / 1000);
        }
        return {
          id: m.id,
          label: m.display_name || m.id,
          created,
        };
      },
    );
}

async function fetchXAIModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://api.x.ai/v1/language-models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`xAI API error: ${response.status}`);
  const data = await response.json();
  const models = Array.isArray(data?.models) ? data.models : [];
  return models
    .filter((m: { output_modalities?: unknown }) => {
      const mods = m.output_modalities;
      if (!Array.isArray(mods)) return true;
      return mods.some((x) => x === "text");
    })
    .filter(
      (m: { id?: unknown }): m is { id: string; created?: number } =>
        typeof m.id === "string",
    )
    .map(
      (m: { id: string; created?: number }): ModelOption => ({
        id: m.id,
        label: m.id,
        created: typeof m.created === "number" ? m.created : undefined,
      }),
    );
}

