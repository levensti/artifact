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
 * Modality keywords that mark a model as NOT chat-completions-capable.
 *
 * Applied uniformly to every provider that returns mixed catalogs —
 * OpenAI, OpenAI-compatible aggregators (OpenRouter, Together,
 * Fireworks, etc.) — so a single pass blocks `whisper-1`, `gpt-image-1`,
 * `text-embedding-3-large`, `claude-3-5-haiku-tts` (hypothetical), etc.
 * Anthropic and xAI's own endpoints already pre-filter by modality so
 * this list isn't reapplied there.
 *
 * Matching is *segment-based*: we split the model ID on `-` and `/` and
 * reject if any segment equals a token in this set. That catches both
 * `whisper-1` (prefix) and `gpt-4o-mini-tts` (suffix) without the
 * false-positives a substring match would cause (`instruct`, `mini`).
 *
 * When you add a new keyword here:
 *   - keep it lowercase
 *   - ensure it's specific enough that no legitimate chat model would
 *     legitimately use it as a `-`-delimited segment
 *   - put it under the right modality heading
 */
const NON_CHAT_TOKENS = new Set<string>([
  // — Embeddings
  "embedding",
  "embed",

  // — Audio: speech-to-text
  "whisper",
  "transcribe",

  // — Audio: text-to-speech
  "tts",

  // — Audio: combined / unspecified
  "audio",

  // — Image generation
  "image",
  // (also: `dall-e` — handled as a substring below because the
  //  internal dash splits into ["dall", "e"], neither a useful token)

  // — Moderation
  "moderation",

  // — Search-augmented endpoints (OpenAI-specific surface, not chat
  //   completions — distinct from chat models that *call* a search tool)
  "search",

  // — Realtime API (separate streaming transport, not chat completions)
  "realtime",

  // — Code-specific completion (Codex)
  "codex",

  // — Legacy pre-chat completion families
  "davinci",
  "babbage",
  "curie",
  "ada",
]);

function modelIdSegments(id: string): string[] {
  return id.toLowerCase().split(/[-/]/);
}

/**
 * Provider-agnostic modality filter. True if the model ID looks like
 * a non-chat-completions model (embeddings, audio, image, etc.).
 */
function isNonChatModalityId(id: string): boolean {
  for (const seg of modelIdSegments(id)) {
    if (NON_CHAT_TOKENS.has(seg)) return true;
  }
  if (/dall-?e/i.test(id)) return true;
  return false;
}

/**
 * OpenAI-specific filter: gate by the chat-family prefixes (gpt*, o\d,
 * chatgpt*) since OpenAI's `/v1/models` lists arbitrary artifacts, then
 * apply the shared modality exclusion.
 */
function looksLikeOpenAIChatModel(id: string): boolean {
  if (
    !id.startsWith("gpt") &&
    !/^o\d/.test(id) &&
    !id.startsWith("chatgpt")
  ) {
    return false;
  }
  if (isNonChatModalityId(id)) return false;
  // Legacy `/v1/completions`-only model; "instruct" alone is too common
  // a token (community chat-instruct-tuned models use it) to blanket
  // exclude, so handle this OpenAI-specific id explicitly.
  if (
    id === "gpt-3.5-turbo-instruct" ||
    id.startsWith("gpt-3.5-turbo-instruct-")
  ) {
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
        typeof m.id === "string" && looksLikeOpenAIChatModel(m.id),
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
        typeof m.id === "string" && !isNonChatModalityId(m.id),
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

