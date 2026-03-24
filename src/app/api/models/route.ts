import { NextRequest, NextResponse } from "next/server";
import type { Provider } from "@/lib/models";

interface ModelsRequest {
  provider: Provider;
  apiKey: string;
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

  if (provider === "openai") {
    return NextResponse.json({ models: await fetchOpenAIModels(apiKey) });
  }
  if (provider === "anthropic") {
    return NextResponse.json({ models: await fetchAnthropicModels(apiKey) });
  }
  if (provider === "openrouter") {
    return NextResponse.json({ models: await fetchOpenRouterModels(apiKey) });
  }

  return jsonError("Invalid provider.", 400);
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

async function fetchOpenRouterModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://artifactml.com",
      "X-Title": "Artifact",
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
