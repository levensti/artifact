import { NextRequest, NextResponse } from "next/server";
import { isInferenceProviderType } from "@/lib/models";
import { getInferenceProfile } from "@/lib/server/store";
import { parseApiErrorMessage } from "@/lib/api-utils";
import {
  isProvider,
  openAiCompatibleModelsListUrl,
  type OpenAiCompatibleProvider,
} from "@/lib/ai-providers";
interface ModelsRequest {
  provider: unknown;
  apiKey?: unknown;
  apiBaseUrl?: unknown;
  profileId?: unknown;
}

interface ModelOption {
  id: string;
  label: string;
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

  const { provider, apiKey, apiBaseUrl, profileId } = body;

  if (!isProvider(provider)) {
    return jsonError("Invalid provider.", 400);
  }

  let effectiveKey: string;
  let effectiveBase: string | undefined;

  if (isInferenceProviderType(provider)) {
    if (!profileId || typeof profileId !== "string" || !profileId.trim()) {
      return jsonError("profileId is required for inference providers.", 400);
    }
    const prof = getInferenceProfile(profileId.trim());
    if (!prof || prof.kind !== provider) {
      return jsonError("Invalid or unknown inference profile.", 400);
    }
    if (!prof.apiKey?.trim() || !prof.baseUrl?.trim()) {
      return jsonError("Inference profile is missing API key or base URL.", 400);
    }
    effectiveKey = prof.apiKey;
    effectiveBase = prof.baseUrl.trim();
  } else {
    if (!apiKey || typeof apiKey !== "string") {
      return jsonError("API key is required.", 401);
    }
    effectiveKey = apiKey;
    effectiveBase =
      typeof apiBaseUrl === "string" ? apiBaseUrl.trim() : undefined;
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
    const message =
      err instanceof Error ? err.message : "Failed to load model list";
    return jsonError(message, 502);
  }
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const data = await response.json();
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .map((m: { id?: string }) => m.id)
    .filter((id: unknown): id is string => typeof id === "string")
    .filter((id: string) => id.includes("gpt") || id.startsWith("o"))
    .sort((a: string, b: string) => a.localeCompare(b))
    .map((id: string) => ({ id, label: id }));
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
    .map((m: { id?: string }) => m.id)
    .filter((id: unknown): id is string => typeof id === "string")
    .sort((a: string, b: string) => a.localeCompare(b))
    .map((id: string) => ({ id, label: id }));
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
    .map((m: { id?: string; display_name?: string }) => ({
      id: m.id ?? "",
      label: m.display_name || m.id || "",
    }))
    .filter((m: ModelOption) => !!m.id)
    .sort((a: ModelOption, b: ModelOption) => a.label.localeCompare(b.label));
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
    .map((m: { id?: string }) => m.id)
    .filter((id: unknown): id is string => typeof id === "string")
    .sort((a: string, b: string) => a.localeCompare(b))
    .map((id: string) => ({ id, label: id }));
}

