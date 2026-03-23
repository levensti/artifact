import { NextRequest } from "next/server";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  provider: "anthropic" | "openai";
  apiKey: string;
  paperContext?: string;
}

const SYSTEM_PROMPT = `You are Paper Copilot, an expert AI research assistant helping a researcher understand an academic paper. You have deep expertise across machine learning, computer science, mathematics, statistics, and related fields.

Your role:
- Explain concepts clearly and precisely, adjusting depth to the question
- When referencing the paper, cite specific sections, equations, or figures
- Provide critical analysis when asked — identify strengths, weaknesses, and assumptions
- Connect ideas to the broader literature when relevant
- Be concise but thorough — researchers value density of insight over verbosity
- Use LaTeX notation for math when appropriate (wrapped in $ or $$)

When the user selects text from the paper and asks about it, focus your answer on that specific passage while drawing on the full paper context as needed.`;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const VALID_PROVIDERS = new Set(["anthropic", "openai"]);

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { messages, model, provider, apiKey, paperContext } = body;

  if (!apiKey || typeof apiKey !== "string") {
    return jsonError("API key is required. Please add your key in Settings.", 401);
  }

  if (!VALID_PROVIDERS.has(provider)) {
    return jsonError("Invalid provider. Must be 'anthropic' or 'openai'.", 400);
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError("Messages array is required and must not be empty.", 400);
  }

  if (!model || typeof model !== "string") {
    return jsonError("Model ID is required.", 400);
  }

  try {
    if (provider === "anthropic") {
      return await streamAnthropic(messages, model, apiKey, paperContext);
    } else {
      return await streamOpenAI(messages, model, apiKey, paperContext);
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
) {
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

  // Transform Anthropic SSE stream to simple text stream
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
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

            try {
              const event = JSON.parse(data);
              if (
                event.type === "content_block_delta" &&
                event.delta?.type === "text_delta"
              ) {
                controller.enqueue(encoder.encode(event.delta.text));
              }
            } catch {
              // skip malformed events
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}

async function streamOpenAI(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  paperContext?: string,
) {
  const systemContent = paperContext
    ? `${SYSTEM_PROMPT}\n\n<paper>\n${paperContext}\n</paper>`
    : SYSTEM_PROMPT;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
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
    let errorMessage = `OpenAI API error: ${response.status}`;
    try {
      const parsed = JSON.parse(errorText);
      errorMessage = parsed.error?.message || errorMessage;
    } catch {
      // use default error message
    }
    return jsonError(errorMessage, response.status);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
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

            try {
              const event = JSON.parse(data);
              const content = event.choices?.[0]?.delta?.content;
              if (content) {
                controller.enqueue(encoder.encode(content));
              }
            } catch {
              // skip malformed events
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}
