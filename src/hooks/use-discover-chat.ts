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
  isModelReady,
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
  submit: (text: string, opts?: { skipWebSearch?: boolean }) => Promise<void>;
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
 * One-line summary of every tool call in a stream — name + key arg + a
 * meaningful status (result count for searches, ok/error/none for others).
 * Appended to `notes` when picks weren't submitted so the queue section
 * shows what actually happened.
 */
function toolActivitySummary(steps: AgentStep[]): string {
  const calls = steps.filter(
    (s): s is Extract<AgentStep, { kind: "tool_call" }> => s.kind === "tool_call",
  );
  if (calls.length === 0) return "";
  const lines = calls.map((c) => {
    const arg =
      typeof c.input.query === "string"
        ? `"${c.input.query}"`
        : typeof c.input.arxivId === "string"
          ? c.input.arxivId
          : "";
    return `- \`${c.name}\`${arg ? ` ${arg}` : ""} — ${describeOutput(c.name, c.output)}`;
  });
  return `**Tool activity:**\n${lines.join("\n")}`;
}

function describeOutput(name: string, output: string | undefined): string {
  if (!output) return "no result";
  const trimmed = output.trim();
  if (trimmed === "EXA_KEY_REQUIRED") return "exa key required";
  if (
    /^(?:error:|paper search failed:|web search failed:|request failed:|tool error:)/i.test(
      trimmed,
    )
  ) {
    return "error";
  }
  if (name === "arxiv_search") {
    const m = trimmed.match(/^Found (\d+) papers/m);
    if (m) return `${m[1]} results`;
    if (/^No papers found/i.test(trimmed)) return "0 results";
  }
  if (name === "web_search") {
    const m = trimmed.match(/^Found (\d+) web results/m);
    if (m) return `${m[1]} results`;
    if (/^No web results found/i.test(trimmed)) return "0 results";
  }
  if (name === "paper_details") {
    if (/^No details found/i.test(trimmed)) return "no metadata";
    if (/^Failed to fetch/i.test(trimmed)) return "fetch failed";
    return "ok";
  }
  if (name === "submit_picks") return "submitted";
  return "ok";
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
  // Last text the user submitted, kept across submissions so the Exa
  // key prompt can resume by re-submitting the same query.
  const lastQueryRef = useRef<string | null>(null);
  // Pending resume queued while a stream was still in flight. Fires from
  // an effect once `isStreaming` flips false — without this the inline
  // card hides immediately on key-add but submit() early-returns due to
  // isStreaming, leaving the user without a retry.
  const pendingResumeRef = useRef<{
    skipWebSearch: boolean;
    text: string;
  } | null>(null);

  const hasKeyForModel = selectedModel != null && isModelReady(selectedModel);

  const submit = useCallback(
    async (text: string, opts?: { skipWebSearch?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || !selectedModel) return;
      if (!isModelReady(selectedModel)) return;

      lastQueryRef.current = trimmed;

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

        const creds = resolveModelCredentials(selectedModel) ?? { apiKey: "" };
        const exaKey = getExaApiKey();
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: trimmed }],
            model: selectedModel.modelId,
            provider: selectedModel.provider,
            ...creds,
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
            // to notes so the queue's auto-expanded notes shows whether
            // the agent actually ran any searches — without it, you can't
            // tell narrate-and-stop from search-found-nothing.
            const activity =
              structured && structured.length > 0 ? "" : toolActivitySummary(steps);
            const enrichedText = activity
              ? `${finalText.trim()}\n\n${activity}`.trim()
              : finalText;

            await finalizeDiscoverQuery(queryId, {
              status: streamSucceeded ? "complete" : "errored",
              ...(structured && structured.length > 0
                ? { picks: structured, notes: finalText.trim() || null }
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
      const target = text ?? lastQueryRef.current;
      if (!target) return;
      if (isStreaming) {
        // Queue and let the effect below fire when the stream ends.
        pendingResumeRef.current = { skipWebSearch, text: target };
        return;
      }
      // The previous query row stays in the queue with status "complete"
      // but no recommendations — the user can delete it from the section
      // header if they want to clean up.
      void submit(target, { skipWebSearch });
    },
    [isStreaming, submit],
  );

  useEffect(() => {
    if (isStreaming) return;
    const pending = pendingResumeRef.current;
    if (!pending) return;
    pendingResumeRef.current = null;
    void submit(pending.text, { skipWebSearch: pending.skipWebSearch });
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
