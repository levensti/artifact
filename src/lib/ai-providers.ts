import { PROVIDER_ORDER, type Provider } from "./models";

/** All providers supported by /api/chat and /api/generate. */
export const API_PROVIDER_SET: ReadonlySet<Provider> = new Set(PROVIDER_ORDER);

export type OpenAiCompatibleProvider = Exclude<Provider, "anthropic">;

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && API_PROVIDER_SET.has(value as Provider);
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
    case "openrouter":
      return "OpenRouter";
  }
}

export function openAiCompatibleChatCompletionsUrl(
  provider: OpenAiCompatibleProvider,
): string {
  switch (provider) {
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "xai":
      return "https://api.x.ai/v1/chat/completions";
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
  }
}

/** OpenRouter asks for referer + title on model list and chat requests. */
export const OPENROUTER_HTTP_REFERER = "https://paper-copilot.dev";
export const OPENROUTER_APP_TITLE = "Paper Copilot";

export function invalidApiProviderMessage(): string {
  return `Invalid provider. Must be ${PROVIDER_ORDER.map((p) => `'${p}'`).join(", ")}.`;
}
