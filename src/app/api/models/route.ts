import { NextRequest, NextResponse } from "next/server";
import {
  isProvider,
  OPENROUTER_APP_TITLE,
  OPENROUTER_HTTP_REFERER,
} from "@/lib/ai-providers";
interface ModelsRequest {
  provider: unknown;
  apiKey: unknown;
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

  const { provider, apiKey } = body;
  if (!apiKey || typeof apiKey !== "string") {
    return jsonError("API key is required.", 401);
  }

  if (!isProvider(provider)) {
    return jsonError("Invalid provider.", 400);
  }

  try {
    if (provider === "openai") {
      return NextResponse.json({ models: await fetchOpenAIModels(apiKey) });
    }
    if (provider === "anthropic") {
      return NextResponse.json({ models: await fetchAnthropicModels(apiKey) });
    }
    if (provider === "openrouter") {
      return NextResponse.json({ models: await fetchOpenRouterModels(apiKey) });
    }
    return NextResponse.json({ models: await fetchXAIModels(apiKey) });
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

async function fetchOpenRouterModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": OPENROUTER_HTTP_REFERER,
      "X-Title": OPENROUTER_APP_TITLE,
    },
  });
  if (!response.ok) throw new Error(`OpenRouter API error: ${response.status}`);
  const data = await response.json();
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .map((m: { id?: string; name?: string }) => ({
      id: m.id ?? "",
      label: m.name || m.id || "",
    }))
    .filter((m: ModelOption) => !!m.id)
    .sort((a: ModelOption, b: ModelOption) => a.label.localeCompare(b.label));
}
