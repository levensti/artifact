import { BUILTIN_PROVIDER_ORDER, type Provider } from "./models";

const INFERENCE_PROVIDERS: Provider[] = [
  "openai_compatible",
];

/** All providers supported by /api/chat and /api/generate. */
export const API_PROVIDER_SET: ReadonlySet<Provider> = new Set([
  ...BUILTIN_PROVIDER_ORDER,
  ...INFERENCE_PROVIDERS,
]);

/** Providers using OpenAI Chat Completions shape (incl. custom base URL). */
export type OpenAiCompatibleProvider = Exclude<Provider, "anthropic">;

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && API_PROVIDER_SET.has(value as Provider);
}

export function isAnthropicMessagesProvider(
  value: Provider,
): value is "anthropic" {
  return value === "anthropic";
}

/** Human-readable name for API error messages and logs. */
export function providerApiErrorLabel(provider: Provider): string {
  switch (provider) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "xai":
      return "xAI";
    case "openai_compatible":
      return "OpenAI-compatible API";
  }
}

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

export function isLocalhostUrl(url: string): boolean {
  const s = url.trim();
  if (!s) return false;
  try {
    const withScheme = /^https?:\/\//i.test(s) ? s : `http://${s}`;
    const u = new URL(withScheme);
    return LOCALHOST_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * An inference profile is usable if it has a base URL AND either a local
 * server (no auth) or an API key. Cloud profiles (Fireworks, OpenRouter, …)
 * still require a key.
 */
export function hasInferenceCredentials(p: {
  baseUrl: string;
  apiKey: string;
}): boolean {
  if (!p.baseUrl.trim()) return false;
  return isLocalhostUrl(p.baseUrl) || !!p.apiKey.trim();
}

/**
 * Normalize user input for OpenAI-compatible servers (e.g. Fireworks `.../inference/v1`).
 * If the URL has no path (only origin, e.g. `https://api.sailresearch.com`), defaults to `/v1`
 * so `.../models` and `.../chat/completions` resolve correctly.
 *
 * For schemeless input pointing at a localhost host (e.g. `localhost:11434/v1`), defaults to
 * `http://` since local LLM servers like Ollama / LM Studio / llama.cpp don't serve TLS.
 */
export function normalizeOpenAiCompatibleBase(raw: string): string {
  const s = raw.trim();
  if (!s) throw new Error("Base URL is empty.");
  let withScheme: string;
  if (/^https?:\/\//i.test(s)) {
    withScheme = s;
  } else {
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(s);
    withScheme = `${isLocal ? "http" : "https"}://${s}`;
  }
  const u = new URL(withScheme);
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Invalid base URL.");
  }
  let path = u.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/") {
    path = "/v1";
  }
  return `${u.origin}${path}`;
}

export function openAiCompatibleChatCompletionsUrl(
  provider: OpenAiCompatibleProvider,
  customBaseUrl?: string | null,
): string {
  if (provider === "openai_compatible") {
    const normalized = normalizeOpenAiCompatibleBase(customBaseUrl ?? "");
    return `${normalized}/chat/completions`;
  }
  switch (provider) {
    case "xai":
      return "https://api.x.ai/v1/chat/completions";
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
  }
}

/** OpenAI-style GET /v1/models for listing models. */
export function openAiCompatibleModelsListUrl(
  provider: OpenAiCompatibleProvider,
  customBaseUrl?: string | null,
): string {
  if (provider === "openai_compatible") {
    const normalized = normalizeOpenAiCompatibleBase(customBaseUrl ?? "");
    return `${normalized}/models`;
  }
  switch (provider) {
    case "xai":
      return "https://api.x.ai/v1/models";
    case "openai":
      return "https://api.openai.com/v1/models";
  }
}

export function invalidApiProviderMessage(): string {
  const all = [...BUILTIN_PROVIDER_ORDER, ...INFERENCE_PROVIDERS];
  return `Invalid provider. Must be ${all.map((p) => `'${p}'`).join(", ")}.`;
}
