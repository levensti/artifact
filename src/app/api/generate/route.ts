import { NextRequest } from "next/server";
import {
  invalidApiProviderMessage,
  isAnthropicMessagesProvider,
  isProvider,
  openAiCompatibleChatCompletionsUrl,
  providerApiErrorLabel,
  type OpenAiCompatibleProvider,
} from "@/lib/ai-providers";
import { jsonError, parseApiErrorMessage } from "@/lib/api-utils";
import type { GenerateRequest } from "@/lib/explore";
import { isInferenceProviderType } from "@/lib/models";

const SYSTEM_PROMPT = `You are an expert AI research assistant helping a researcher understand an academic paper. Return only the content requested by the user prompt.

When asked to output JSON:
- Return valid JSON only
- Do not include markdown fences
- Do not include extra commentary`;

export async function POST(req: NextRequest) {
  let body: GenerateRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { model, provider, apiKey, apiBaseUrl, prompt, paperContext } = body;

  if (!isProvider(provider)) {
    return jsonError(invalidApiProviderMessage(), 400);
  }

  if (!model || typeof model !== "string") {
    return jsonError("Model ID is required.", 400);
  }

  if (!prompt || typeof prompt !== "string") {
    return jsonError("Prompt is required.", 400);
  }
  if (
    prompt.length > 50_000 ||
    (paperContext && paperContext.length > 500_000)
  ) {
    return jsonError("Request payload too large.", 413);
  }

  const effectiveApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const effectiveBaseUrl =
    typeof apiBaseUrl === "string" ? apiBaseUrl.trim() : "";

  if (!effectiveApiKey) {
    return jsonError(
      "API key is required. Manage API keys in the app to add one.",
      401,
    );
  }
  if (isInferenceProviderType(provider) && !effectiveBaseUrl) {
    return jsonError(
      "apiBaseUrl is required for OpenAI-compatible providers.",
      400,
    );
  }

  try {
    const content = isAnthropicMessagesProvider(provider)
      ? await generateAnthropic(model, effectiveApiKey, prompt, paperContext)
      : await generateOpenAICompatible(
          model,
          effectiveApiKey,
          prompt,
          paperContext,
          provider as OpenAiCompatibleProvider,
          provider === "openai_compatible" ? effectiveBaseUrl : undefined,
        );

    return new Response(JSON.stringify({ content }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
}

async function generateAnthropic(
  model: string,
  apiKey: string,
  prompt: string,
  paperContext?: string,
): Promise<string> {
  const systemContent = paperContext
    ? `${SYSTEM_PROMPT}\n\n<paper>\n${paperContext}\n</paper>`
    : SYSTEM_PROMPT;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemContent,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw await parseError(response, "Anthropic");
  }

  const data = await response.json();
  return data?.content?.[0]?.text ?? "";
}

async function generateOpenAICompatible(
  model: string,
  apiKey: string,
  prompt: string,
  paperContext: string | undefined,
  provider: OpenAiCompatibleProvider,
  customOpenAiBaseUrl?: string,
): Promise<string> {
  const baseUrl = openAiCompatibleChatCompletionsUrl(provider, customOpenAiBaseUrl);

  const systemContent = paperContext
    ? `${SYSTEM_PROMPT}\n\n<paper>\n${paperContext}\n</paper>`
    : SYSTEM_PROMPT;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: prompt },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw await parseError(response, providerApiErrorLabel(provider));
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

async function parseError(response: Response, providerLabel: string) {
  const errorText = await response.text();
  const fallback = `${providerLabel} API error: ${response.status}`;
  return new Error(parseApiErrorMessage(errorText, fallback));
}
