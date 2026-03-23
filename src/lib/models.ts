export type Provider = "anthropic" | "openai" | "openrouter";

export interface Model {
  id: string;
  label: string;
  provider: Provider;
  modelId: string;
}

export const MODELS: Model[] = [
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
];

export const PROVIDER_META: Record<Provider, { label: string; description: string }> = {
  anthropic: {
    label: "Anthropic",
    description: "Claude models — excellent for nuanced reasoning and long-context analysis",
  },
  openai: {
    label: "OpenAI",
    description: "GPT and o-series models — strong general-purpose and reasoning capabilities",
  },
  openrouter: {
    label: "OpenRouter",
    description: "Unified gateway to 200+ models — access any provider through a single API key",
  },
};
