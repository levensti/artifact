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
  /**
   * Unix epoch seconds when the provider published this model. Used to
   * sort the picker (newest first) and to pick the "head" of a family
   * when no alias is present. Optional because some providers don't
   * return it.
   */
  created?: number;
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

/**
 * Best-effort context-window size (in tokens) for a model, used by the
 * server's context-budgeting pass. With BYOK + arbitrary OpenAI-compatible
 * endpoints we can't always know the real window, so this returns a
 * conservative estimate per provider/family and falls back to 128k. Erring
 * small only means we trim history a little sooner — never an overflow.
 */
export function contextWindowFor(provider: Provider, modelId: string): number {
  const id = modelId.toLowerCase();
  if (provider === "anthropic") {
    // Recent Claude (3.5 / 4 families) are 200k; the 1M window is opt-in and
    // not assumed here.
    return 200_000;
  }
  if (provider === "openai") {
    if (id.includes("gpt-4.1")) return 1_000_000;
    if (id.startsWith("o1") || id.startsWith("o3")) return 200_000;
    return 128_000; // gpt-4o and the safe default
  }
  if (provider === "xai") {
    if (id.includes("grok-4")) return 256_000;
    return 131_072;
  }
  // openai_compatible / local / unknown — stay conservative.
  return 128_000;
}

export function modelsGroupedByProvider(): {
  provider: Provider;
  models: Model[];
}[] {
  return BUILTIN_PROVIDER_ORDER.map((provider) => ({
    provider,
    models: FALLBACK_MODELS.filter((m) => m.provider === provider),
  }));
}
