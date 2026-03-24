export type Provider = "anthropic" | "openai" | "openrouter";

/** Stable order for settings UI and model dropdown groups. */
export const PROVIDER_ORDER: Provider[] = ["anthropic", "openai", "openrouter"];

export interface Model {
  id: string;
  label: string;
  provider: Provider;
  modelId: string;
}

export const FALLBACK_MODELS: Model[] = [
  {
    id: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    provider: "anthropic",
    modelId: "claude-sonnet-4-20250514",
  },
  {
    id: "claude-opus-4",
    label: "Claude Opus 4",
    provider: "anthropic",
    modelId: "claude-opus-4-20250514",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    modelId: "gpt-4o",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openai",
    modelId: "gpt-4o-mini",
  },
  {
    id: "o3-mini",
    label: "o3-mini",
    provider: "openai",
    modelId: "o3-mini",
  },
  {
    id: "or-deepseek-r1",
    label: "DeepSeek R1",
    provider: "openrouter",
    modelId: "deepseek/deepseek-r1",
  },
  {
    id: "or-gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "openrouter",
    modelId: "google/gemini-2.5-pro-preview",
  },
  {
    id: "or-llama-4-maverick",
    label: "Llama 4 Maverick",
    provider: "openrouter",
    modelId: "meta-llama/llama-4-maverick",
  },
];

export const PROVIDER_META: Record<
  Provider,
  { label: string; description: string; keyHint: string }
> = {
  anthropic: {
    label: "Anthropic",
    description: "Claude models. Uses an Anthropic API key.",
    keyHint: "Anthropic API key",
  },
  openai: {
    label: "OpenAI",
    description: "OpenAI Chat Completions models. Uses an OpenAI API key.",
    keyHint: "OpenAI API key",
  },
  openrouter: {
    label: "OpenRouter",
    description: "Third-party models via OpenRouter. Uses an OpenRouter API key.",
    keyHint: "OpenRouter API key",
  },
};

export function modelsGroupedByProvider(): { provider: Provider; models: Model[] }[] {
  return PROVIDER_ORDER.map((provider) => ({
    provider,
    models: FALLBACK_MODELS.filter((m) => m.provider === provider),
  }));
}
