"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Model } from "@/lib/models";
import {
  createDiscoverQuery,
  finalizeDiscoverQuery,
} from "@/lib/client-data";
import {
  getExaApiKey,
  hasUsableExaKey,
  hasUsableProvider,
  resolveModelCredentials,
} from "@/lib/keys";
import type { StreamEvent } from "@/lib/stream-types";
import { processStreamEvent, type AgentStep } from "@/hooks/use-chat";

/* ------------------------------------------------------------------ */
/*  NDJSON parser (mirrors use-chat.ts)                                */
/* ------------------------------------------------------------------ */

async function parseNDJSONStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: StreamEvent;
        try {
          event = JSON.parse(trimmed) as StreamEvent;
        } catch {
          continue;
        }
        onEvent(event);
      }
    }
    if (buffer.trim()) {
      let event: StreamEvent;
      try {
        event = JSON.parse(buffer.trim()) as StreamEvent;
      } catch {
        return;
      }
      onEvent(event);
    }
  } finally {
    reader.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

interface UseDiscoverChatOptions {
  selectedModel: Model | null;
}

export interface UseDiscoverChatReturn {
  isStreaming: boolean;
  /** Steps for the in-flight query stream — drops to [] once finalized. */
  liveSteps: AgentStep[];
  /** Id of the DiscoverQuery currently being filled (so the UI can pin
   *  the live stream above the queue and transition cleanly when done). */
  liveQueryId: string | null;
  /** Live echo of the user's input for the in-flight query. */
  liveQueryText: string | null;
  error: string | null;
  hasKeyForModel: boolean;
  submit: (
    text: string,
    opts?: { skipWebSearch?: boolean; promptText?: string },
  ) => Promise<void>;
  /** Re-submits a query after the user resolves the Exa key prompt
   *  (added a key → skipWebSearch=false; dismissed → true). Defaults to
   *  the most recent query; pass `text` to retry a specific historical
   *  query (used by the queue's persistent card). If a stream is still
   *  in flight, the resume is queued and fires when it ends. */
  resumeAfterExaDecision: (opts: {
    skipWebSearch: boolean;
    text?: string;
  }) => void;
  /** Set when `submit` was deferred because no Exa key is configured
   *  and the user hasn't already opted to skip web search. The panel
   *  surfaces the prompt card so the user can add a key (resume) or
   *  dismiss (proceed without web_search) before the agent starts. */
  pendingExaDecision: { text: string } | null;
}

/**
 * The agent emits one text segment per round (between tool batches). Joining
 * them with "" produces a wall of prose; rendering them as a numbered
 * Markdown list preserves the round boundaries and reads as the timeline
 * it actually is. Empty segments are dropped so we don't get blank steps.
 */
function stepsToFinalText(steps: AgentStep[]): string {
  const segments = steps
    .filter((s): s is Extract<AgentStep, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text.trim())
    .filter(Boolean);
  if (segments.length === 0) return "";
  if (segments.length === 1) return segments[0];
  return segments.map((text, i) => `${i + 1}. ${text}`).join("\n\n");
}

/**
 * A human-readable research log of what the agent actually did — appended to
 * `notes` when no picks were submitted, so the brief can show "what I tried"
 * without leaking raw tool names. The "What I did:" marker is also how the UI
 * distinguishes "ran tools but didn't finalize" from "narrated only" (see
 * research-brief.tsx). The literal "exa key required" phrase is preserved so
 * the Exa-key prompt can still detect that failure mode.
 */
function toolActivitySummary(steps: AgentStep[]): string {
  const calls = steps.filter(
    (s): s is Extract<AgentStep, { kind: "tool_call" }> => s.kind === "tool_call",
  );
  const lines = calls.map(humanToolLine).filter(Boolean);
  if (lines.length === 0) return "";
  return `**What I did:**\n${lines.join("\n")}`;
}

function searchCount(output: string, kind: "papers" | "web results"): string | null {
  const m = output.match(new RegExp(`^Found (\\d+) ${kind}`, "m"));
  if (m) return m[1];
  if (new RegExp(`^No ${kind}`, "i").test(output)) return "0";
  return null;
}

function humanToolLine(c: Extract<AgentStep, { kind: "tool_call" }>): string {
  const query = typeof c.input.query === "string" ? c.input.query : "";
  const paperId = typeof c.input.arxivId === "string" ? c.input.arxivId : "";
  const out = (c.output ?? "").trim();

  switch (c.name) {
    case "arxiv_search": {
      const n = out ? searchCount(out, "papers") : null;
      return `- Searched arXiv${query ? ` for “${query}”` : ""}${
        n !== null ? ` — ${n} found` : ""
      }`;
    }
    case "web_search": {
      if (out === "EXA_KEY_REQUIRED") return "- Web search — exa key required";
      const n = out ? searchCount(out, "web results") : null;
      return `- Searched the web${query ? ` for “${query}”` : ""}${
        n !== null ? ` — ${n} found` : ""
      }`;
    }
    case "paper_details": {
      if (/^Failed to fetch/i.test(out) || /^No details found/i.test(out)) {
        return `- Couldn’t open ${paperId || "a paper"}`;
      }
      return `- Read ${paperId || "a paper"}`;
    }
    case "submit_picks":
      return "";
    default:
      return "";
  }
}

interface StructuredPick {
  url: string;
  title: string;
  rationale: string;
  arxivId?: string;
}

/**
 * Extract picks from the most recent `submit_picks` tool_call event in the
 * stream. Returns null if the agent didn't call submit_picks (caller falls
 * back to parsing the assistant text on the server).
 */
function extractStructuredPicks(steps: AgentStep[]): StructuredPick[] | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.kind !== "tool_call" || step.name !== "submit_picks") continue;
    const raw = step.input?.picks;
    if (!Array.isArray(raw)) return null;
    const picks: StructuredPick[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const p = item as Record<string, unknown>;
      const url = typeof p.url === "string" ? p.url.trim() : "";
      const title = typeof p.title === "string" ? p.title.trim() : "";
      const rationale =
        typeof p.rationale === "string" ? p.rationale.trim() : "";
      if (!url || !title) continue;
      picks.push({
        url,
        title,
        rationale,
        arxivId: typeof p.arxivId === "string" ? p.arxivId.trim() : undefined,
      });
    }
    return picks;
  }
  return null;
}

export function useDiscoverChat({
  selectedModel,
}: UseDiscoverChatOptions): UseDiscoverChatReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [liveQueryId, setLiveQueryId] = useState<string | null>(null);
  const [liveQueryText, setLiveQueryText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingExaDecision, setPendingExaDecision] = useState<
    { text: string } | null
  >(null);
  // Last submission, kept across submissions so the Exa key prompt can
  // resume by re-submitting. `text` is what's stored/displayed; `promptText`
  // is the (optional) context-augmented prompt actually sent to the agent —
  // both are preserved so a follow-up resumed after an Exa decision keeps
  // its context.
  const lastSubmitRef = useRef<{ text: string; promptText?: string } | null>(
    null,
  );
  // Pending resume queued while a stream was still in flight. Fires from
  // an effect once `isStreaming` flips false — without this the inline
  // card hides immediately on key-add but submit() early-returns due to
  // isStreaming, leaving the user without a retry.
  const pendingResumeRef = useRef<{
    skipWebSearch: boolean;
    text: string;
    promptText?: string;
  } | null>(null);

  const hasKeyForModel = selectedModel != null && hasUsableProvider();

  const submit = useCallback(
    async (
      text: string,
      opts?: { skipWebSearch?: boolean; promptText?: string },
    ) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || !selectedModel) return;
      if (!hasUsableProvider()) return;

      lastSubmitRef.current = { text: trimmed, promptText: opts?.promptText };

      // Pre-flight: if neither the user nor the server has an Exa key,
      // pause and surface the prompt card. Otherwise the agent dispatches
      // `web_search` alongside the arxiv batch, the chip spins as
      // "Searching web" until the slowest parallel call resolves
      // (Promise.all batches results), and only then does it flip to the
      // ExaKeyPromptCard. Asking upfront is honest and skips the
      // misleading spinner. The server-env key path means we DON'T prompt
      // when EXA_API_KEY is set globally — the user already has search.
      if (!opts?.skipWebSearch && !hasUsableExaKey()) {
        setError(null);
        setPendingExaDecision({ text: trimmed });
        return;
      }
      setPendingExaDecision(null);

      setError(null);
      setLiveSteps([]);
      setLiveQueryText(trimmed);
      setIsStreaming(true);

      let queryId: string | null = null;
      let steps: AgentStep[] = [];
      let streamSucceeded = false;

      try {
        const created = await createDiscoverQuery(trimmed);
        queryId = created.id;
        setLiveQueryId(created.id);

        const exaKey = getExaApiKey();
        // What's sent to the agent. For follow-ups this carries the prior
        // question + picks as context, while the stored `query` row keeps the
        // short user-facing text (set via createDiscoverQuery above).
        const agentPrompt = opts?.promptText?.trim() || trimmed;
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: agentPrompt }],
            ...resolveModelCredentials(),
            mode: "discover",
            ...(exaKey ? { exaApiKey: exaKey } : {}),
            ...(opts?.skipWebSearch ? { skipWebSearch: true } : {}),
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string })?.error ??
              `Request failed: ${response.status}`,
          );
        }
        if (!response.body) throw new Error("No response body received");

        await parseNDJSONStream(response.body, (event) => {
          if (event.type === "error") throw new Error(event.message);
          steps = processStreamEvent(steps, event);
          setLiveSteps([...steps]);
        });
        streamSucceeded = true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong";
        setError(message);
      } finally {
        // Always attempt to finalize so the DiscoverQuery row reflects what
        // happened. Picks come out empty when the agent didn't emit a list
        // (errored, no results, etc.); the row still persists with status
        // and notes for history.
        if (queryId) {
          try {
            const finalText = stepsToFinalText(steps);
            const structured = extractStructuredPicks(steps);
            // When picks aren't submitted, append a tool-activity summary
            // to notes — both so a no-picks run shows whether the agent
            // actually searched, AND so a successful brief retains its
            // research trajectory ("How I researched") after the live steps
            // are gone. The brief UI splits this back into synthesis + log.
            const activity = toolActivitySummary(steps);
            const enrichedText = activity
              ? `${finalText.trim()}\n\n${activity}`.trim()
              : finalText.trim();

            await finalizeDiscoverQuery(queryId, {
              status: streamSucceeded ? "complete" : "errored",
              ...(structured && structured.length > 0
                ? { picks: structured, notes: enrichedText || null }
                : { text: enrichedText }),
            });
          } catch {
            // Finalize failure is non-fatal — the in-flight UI is already
            // gone; the query row will just be stuck in "running" state.
          }
        }
        setIsStreaming(false);
        setLiveQueryId(null);
        setLiveSteps([]);
        setLiveQueryText(null);
      }
    },
    [isStreaming, selectedModel],
  );

  const resumeAfterExaDecision = useCallback(
    ({ skipWebSearch, text }: { skipWebSearch: boolean; text?: string }) => {
      // Explicit `text` (a historical retry from a queue card) runs as a
      // fresh query; otherwise replay the last submission, preserving any
      // follow-up context carried in `promptText`.
      const last = lastSubmitRef.current;
      const target = text ?? last?.text ?? null;
      if (!target) return;
      const promptText = text ? undefined : last?.promptText;
      if (isStreaming) {
        // Queue and let the effect below fire when the stream ends.
        pendingResumeRef.current = { skipWebSearch, text: target, promptText };
        return;
      }
      void submit(target, { skipWebSearch, promptText });
    },
    [isStreaming, submit],
  );

  useEffect(() => {
    if (isStreaming) return;
    const pending = pendingResumeRef.current;
    if (!pending) return;
    pendingResumeRef.current = null;
    void submit(pending.text, {
      skipWebSearch: pending.skipWebSearch,
      promptText: pending.promptText,
    });
  }, [isStreaming, submit]);

  return {
    isStreaming,
    liveSteps,
    liveQueryId,
    liveQueryText,
    error,
    hasKeyForModel,
    submit,
    resumeAfterExaDecision,
    pendingExaDecision,
  };
}
