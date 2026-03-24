import { NextRequest } from "next/server";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  provider: "anthropic" | "openai" | "openrouter";
  apiKey: string;
  paperContext?: string;
  /** Optional summary of prerequisites / related-work progress for this review */
  learningContext?: string;
}

const SYSTEM_PROMPT = `You are Paper Copilot, an expert AI research assistant helping a researcher understand an academic paper. You have deep expertise across machine learning, computer science, mathematics, statistics, and related fields.

Your role:
- Explain concepts clearly and precisely, adjusting depth to the question
- When referencing the paper, cite specific sections, equations, or figures
- Provide critical analysis when asked — identify strengths, weaknesses, and assumptions
- Connect ideas to the broader literature when relevant
- Be concise but thorough — researchers value density of insight over verbosity
- Use LaTeX notation for math when appropriate (wrapped in $ or $$)

When the user selects text from the paper and asks about it, focus your answer on that specific passage while drawing on the full paper context as needed.

Pre-reading map (hidden UI): There is a "Pre-reading" panel in the sidebar where users can trigger analysis. When the user asks about recommended reading, background topics, or a reading roadmap for this paper—and a structured checklist would genuinely help—finish with friendly advice, then on its **own final line** output exactly this token (nothing else on that line, no markdown fence):
[[paper-copilot:learning-map]]
The client will run an automated pipeline (find recommended pre-reading topics, derive arXiv keywords, fetch candidates, classify relationships) and update the Pre-reading panel. Omit the token for pure explanations, narrow factual answers, or when <learning_state> already covers what they asked unless they clearly want a fresh analysis. If the paper context is empty, do not emit the token—say they should wait for PDF text. Never claim you personally searched arXiv; the app pipeline does retrieval. When <learning_state> is present, use it faithfully; do not invent checklist items or graph nodes. Note: these are *recommendations*, not hard prerequisites—frame them as "helpful to read" rather than "required".`;

function learningSection(learningContext: string | undefined): string {
  const t = learningContext?.trim();
  if (!t) return "";
  return `\n\n<learning_state>\n${t}\n</learning_state>`;
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const VALID_PROVIDERS = new Set(["anthropic", "openai", "openrouter"]);

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { messages, model, provider, apiKey, paperContext, learningContext } = body;

  if (!apiKey || typeof apiKey !== "string") {
    return jsonError("API key is required. Please add your key in Settings.", 401);
  }

  if (!VALID_PROVIDERS.has(provider)) {
    return jsonError("Invalid provider. Must be 'anthropic', 'openai', or 'openrouter'.", 400);
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError("Messages array is required and must not be empty.", 400);
  }

  if (!model || typeof model !== "string") {
    return jsonError("Model ID is required.", 400);
  }

  try {
    if (provider === "anthropic") {
      return await streamAnthropic(messages, model, apiKey, paperContext, learningContext);
    } else {
      // OpenAI and OpenRouter use the same API format
      const baseUrl =
        provider === "openrouter"
          ? "https://openrouter.ai/api/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
      return await streamOpenAICompatible(
        messages,
        model,
        apiKey,
        paperContext,
        baseUrl,
        provider,
        learningContext,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonError(message, 500);
  }
}

async function streamAnthropic(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  paperContext?: string,
  learningContext?: string,
) {
  const learn = learningSection(learningContext);
  const systemContent = paperContext
    ? `${SYSTEM_PROMPT}${learn}\n\n<paper>\n${paperContext}\n</paper>`
    : `${SYSTEM_PROMPT}${learn}`;

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
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Anthropic API error: ${response.status}`;
    try {
      const parsed = JSON.parse(errorText);
      errorMessage = parsed.error?.message || errorMessage;
    } catch {
      // use default error message
    }
    return jsonError(errorMessage, response.status);
  }

  if (!response.body) {
    return jsonError("No response body from Anthropic", 502);
  }

  return new Response(transformSSEStream(response.body, parseAnthropicDelta), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}

async function streamOpenAICompatible(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  paperContext: string | undefined,
  baseUrl: string,
  provider: string,
  learningContext?: string,
) {
  const learn = learningSection(learningContext);
  const systemContent = paperContext
    ? `${SYSTEM_PROMPT}${learn}\n\n<paper>\n${paperContext}\n</paper>`
    : `${SYSTEM_PROMPT}${learn}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // OpenRouter requires HTTP-Referer for attribution
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://paper-copilot.dev";
    headers["X-Title"] = "Paper Copilot";
  }

  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemContent },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const providerLabel = provider === "openrouter" ? "OpenRouter" : "OpenAI";
    let errorMessage = `${providerLabel} API error: ${response.status}`;
    try {
      const parsed = JSON.parse(errorText);
      errorMessage = parsed.error?.message || errorMessage;
    } catch {
      // use default error message
    }
    return jsonError(errorMessage, response.status);
  }

  if (!response.body) {
    return jsonError(`No response body from ${provider}`, 502);
  }

  return new Response(transformSSEStream(response.body, parseOpenAIDelta), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}

// Shared SSE stream transformer
function transformSSEStream(
  body: ReadableStream<Uint8Array>,
  parseDelta: (data: string) => string | null,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            const text = parseDelta(data);
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });
}

function parseAnthropicDelta(data: string): string | null {
  try {
    const event = JSON.parse(data);
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      return event.delta.text;
    }
  } catch {
    // skip malformed events
  }
  return null;
}

function parseOpenAIDelta(data: string): string | null {
  try {
    const event = JSON.parse(data);
    return event.choices?.[0]?.delta?.content || null;
  } catch {
    // skip malformed events
  }
  return null;
}
