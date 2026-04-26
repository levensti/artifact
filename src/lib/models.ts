export type Provider = "anthropic" | "openai" | "xai" | "openai_compatible";

/** Built-in API providers (single key each). Excludes inference-compatible kinds. */
export const BUILTIN_PROVIDER_ORDER: Provider[] = [
  "anthropic",
  "openai",
  "xai",
];

/** Alias for built-in provider lists (settings groups, keys). */
export const PROVIDER_ORDER = BUILTIN_PROVIDER_ORDER;

export type InferenceProfileKind = "openai_compatible";

/** One named OpenAI- or Anthropic-compatible endpoint (multiple allowed). */
export interface InferenceProviderProfile {
  id: string;
  /** Display name in Settings and the model menu (e.g. Fireworks). */
  label: string;
  kind: InferenceProfileKind;
  baseUrl: string;
  apiKey: string;
  /** Whether the provider supports streaming responses. Default: true. */
  supportsStreaming?: boolean;
}

export interface Model {
  id: string;
  label: string;
  provider: Provider;
  modelId: string;
  /** Set when `provider` is `openai_compatible`. */
  profileId?: string;
}

export function isInferenceProviderType(p: Provider): p is "openai_compatible" {
  return p === "openai_compatible";
}

/** @deprecated use isInferenceProviderType — old name */
export function providerRequiresBaseUrl(provider: Provider): boolean {
  return isInferenceProviderType(provider);
}

export const FALLBACK_MODELS: Model[] = [
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    provider: "anthropic",
    modelId: "claude-opus-4-7",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
  },
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
    id: "grok-3",
    label: "Grok 3",
    provider: "xai",
    modelId: "grok-3",
  },
  {
    id: "grok-3-mini",
    label: "Grok 3 Mini",
    provider: "xai",
    modelId: "grok-3-mini",
  },
  {
    id: "grok-4-0709",
    label: "Grok 4",
    provider: "xai",
    modelId: "grok-4-0709",
  },
];

export const PROVIDER_META: Record<
  Exclude<Provider, "openai_compatible">,
  { label: string }
> = {
  anthropic: {
    label: "Anthropic",
  },
  openai: {
    label: "OpenAI",
  },
  xai: {
    label: "xAI",
  },
};

export function modelsGroupedByProvider(): {
  provider: Provider;
  models: Model[];
}[] {
  return BUILTIN_PROVIDER_ORDER.map((provider) => ({
    provider,
    models: FALLBACK_MODELS.filter((m) => m.provider === provider),
  }));
}
