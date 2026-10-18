"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import type { ScreenScore, StreamEvent } from "@/lib/stream-types";
import type { JudgeDetail } from "@/lib/judge-rubric";
import { normalizeArxivId } from "@/lib/arxiv";
import { processStreamEvent, type AgentStep } from "@/hooks/use-chat";
import {
  buildPaperMetadataPool,
  canonicalUrl,
} from "@/lib/discover-paper-metadata";
import { arxivIdFromUrl } from "@/lib/picks-parser";

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

export interface SubmitOptions {
  skipWebSearch?: boolean;
  /** What's sent to the agent when it differs from the stored question
   *  (follow-up or project context). */
  promptText?: string;
  /** Project the new brief belongs to. */
  projectId?: string | null;
  /** Inputs for the screening funnel: the short question to judge against,
   *  the project's name, and sources it already has. */
  discover?: DiscoverRequestOptions;
}

export interface DiscoverRequestOptions {
  question?: string;
  projectName?: string | null;
  exclude?: { arxivIds: string[]; urls: string[] };
}

/** Attach the funnel's screening scores to the picks they belong to, matched
 *  by arXiv id, else by canonical URL. Picks without one (e.g. from a
 *  targeted search in the final pass) are judged when they're saved. */
function attachScreenScores(
  picks: StructuredPick[],
  scores: ScreenScore[],
): StructuredPick[] {
  if (scores.length === 0) return picks;
  const byKey = new Map<string, ScreenScore>();
  for (const s of scores) {
    if (s.arxivId) byKey.set(`a:${normalizeArxivId(s.arxivId)}`, s);
    byKey.set(`u:${canonicalUrl(s.url)}`, s);
  }
  return picks.map((pick) => {
    const aid = pick.arxivId || arxivIdFromUrl(pick.url);
    const match =
      (aid ? byKey.get(`a:${normalizeArxivId(aid)}`) : undefined) ??
      byKey.get(`u:${canonicalUrl(pick.url)}`);
    return match
      ? { ...pick, judgeScore: match.score, judgeDetail: match.detail }
      : pick;
  });
}

interface UseDiscoverChatOptions {
  modelReady: boolean;
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
    opts?: SubmitOptions,
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
  /** Abort the in-flight run. Whatever the agent produced so far is still
   *  finalized, so a stopped run keeps any picks it already submitted. */
  stop: () => void;
}

/**
 * The text saved as the brief's overview. Once picks are submitted, only what
 * the agent wrote after `submit_picks` counts: that's the explainer, and the
 * earlier segments are working notes ("let me verify…"), not brief content.
 * Without picks (a clarifying reply, a stopped run), keep every segment as a
 * numbered list so the round boundaries survive. Empty segments are dropped.
 */
function stepsToFinalText(steps: AgentStep[]): string {
  const submitAt = steps.findIndex(
    (s) => s.kind === "tool_call" && s.name === "submit_picks",
  );
  const segments = steps
    .filter(
      (s, i): s is Extract<AgentStep, { kind: "text" }> =>
        s.kind === "text" && (submitAt === -1 || i > submitAt),
    )
    .map((s) => s.text.trim())
    .filter(Boolean);
  if (submitAt !== -1) return segments.join("\n\n");
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
    case "screen_sources": {
      const graded = out.match(/Screened (\d+)/)?.[1];
      const kept = out.match(/Shortlisted (\d+)/)?.[1];
      return graded
        ? `- Graded ${graded} sources${kept ? ` — ${kept} shortlisted` : ""}`
        : "";
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
  authors?: string | null;
  publishedDate?: string | null;
  publishedYear?: number | null;
  venue?: string | null;
  citationCount?: number | null;
  /** Screening score from the funnel, when the pick came from its shortlist. */
  judgeScore?: number;
  judgeDetail?: JudgeDetail;
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
        authors: typeof p.authors === "string" ? p.authors.trim() : null,
        publishedDate:
          typeof p.publishedDate === "string" ? p.publishedDate.trim() : null,
        publishedYear:
          typeof p.publishedYear === "number" &&
          Number.isInteger(p.publishedYear)
            ? p.publishedYear
            : null,
        venue: typeof p.venue === "string" ? p.venue.trim() : null,
        citationCount:
          typeof p.citationCount === "number" &&
          Number.isInteger(p.citationCount)
            ? p.citationCount
            : null,
      });
    }
    return picks;
  }
  return null;
}

function parseYear(year: string | null): number | null {
  if (!year) return null;
  const n = Number(year);
  return Number.isInteger(n) ? n : null;
}

function parseCitationCount(citations: string | null): number | null {
  if (!citations) return null;
  const m = citations.match(/\d+/);
  return m ? Number(m[0]) : null;
}

function enrichStructuredPicks(
  picks: StructuredPick[],
  steps: AgentStep[],
): StructuredPick[] {
  const pool = buildPaperMetadataPool(steps);
  return picks.map((pick) => {
    const aid = pick.arxivId || arxivIdFromUrl(pick.url);
    const meta =
      (aid ? pool.byArxivId.get(aid) : undefined) ??
      pool.byUrl.get(canonicalUrl(pick.url)) ??
      null;
    if (!meta) return pick;
    return {
      ...pick,
      arxivId: pick.arxivId ?? meta.arxivId ?? undefined,
      authors: pick.authors ?? (meta.authors || null),
      publishedDate: pick.publishedDate ?? meta.publishedDate,
      publishedYear: pick.publishedYear ?? parseYear(meta.year),
      venue: pick.venue ?? meta.venue,
      citationCount: pick.citationCount ?? parseCitationCount(meta.citations),
    };
  });
}

export function useDiscoverChat({
  modelReady,
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
  const lastSubmitRef = useRef<{ text: string; opts: SubmitOptions } | null>(
    null,
  );
  // Pending resume queued while a stream was still in flight. Fires from
  // an effect once `isStreaming` flips false — without this the inline
  // card hides immediately on key-add but submit() early-returns due to
  // isStreaming, leaving the user without a retry.
  const abortRef = useRef<AbortController | null>(null);
  const pendingResumeRef = useRef<{ text: string; opts: SubmitOptions } | null>(
    null,
  );

  const hasKeyForModel = modelReady && hasUsableProvider();

  const submit = useCallback(
    async (
      text: string,
      opts?: SubmitOptions,
    ) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || !modelReady) return;
      if (!hasUsableProvider()) return;

      lastSubmitRef.current = { text: trimmed, opts: { ...opts } };

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
      let screenScores: ScreenScore[] = [];
      let streamSucceeded = false;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const created = await createDiscoverQuery(
          trimmed,
          opts?.projectId ?? null,
        );
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
            ...(opts?.discover ? { discover: opts.discover } : {}),
          }),
          signal: controller.signal,
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
          if (event.type === "heartbeat") return; // liveness only
          // Early tool-call events: the research trace and picks read each
          // call's full input, so wait for the complete tool_call.
          if (
            event.type === "tool_call_start" ||
            event.type === "tool_call_progress"
          )
            return;
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "screen_scores") {
            screenScores = event.scores;
            // Also hand the shortlist to the live view, on the screening
            // step it came from, so the brief can show it while the agent
            // chooses.
            steps = steps.map((s) =>
              s.kind === "tool_call" && s.name === "screen_sources"
                ? { ...s, input: { ...s.input, shortlist: event.scores } }
                : s,
            );
            setLiveSteps([...steps]);
            return;
          }
          steps = processStreamEvent(steps, event);
          setLiveSteps([...steps]);
        });
        streamSucceeded = true;
      } catch (err) {
        // A user stop isn't an error: the run finalizes with what it has.
        if (controller.signal.aborted) {
          streamSucceeded = true;
        } else {
          const message =
            err instanceof Error ? err.message : "Something went wrong";
          setError(message);
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        // Always attempt to finalize so the DiscoverQuery row reflects what
        // happened. Picks come out empty when the agent didn't emit a list
        // (errored, no results, etc.); the row still persists with status
        // and notes for history.
        if (queryId) {
          let finalText = "";
          let structuredPickCount = 0;
          try {
            finalText = stepsToFinalText(steps);
            const structured = extractStructuredPicks(steps);
            const enrichedStructured = structured
              ? attachScreenScores(
                  enrichStructuredPicks(structured, steps),
                  screenScores,
                )
              : null;
            structuredPickCount =
              enrichedStructured?.length ?? structured?.length ?? 0;
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
              ...(enrichedStructured && enrichedStructured.length > 0
                ? { picks: enrichedStructured, notes: enrichedText || null }
                : { text: enrichedText }),
            });
          } catch (finalizeErr) {
            // Finalize failure is non-fatal for the live stream, but it is
            // exactly the kind of persistence issue that leaves a finished
            // brief looking empty after reload.
            console.error("Failed to finalize discover query", {
              queryId,
              stepCount: steps.length,
              structuredPickCount,
              finalTextLength: finalText.length,
              error: finalizeErr,
            });
          }
        }
        setIsStreaming(false);
        setLiveQueryId(null);
        setLiveSteps([]);
        setLiveQueryText(null);
      }
    },
    [isStreaming, modelReady],
  );

  const resumeAfterExaDecision = useCallback(
    ({ skipWebSearch, text }: { skipWebSearch: boolean; text?: string }) => {
      // Explicit `text` (a historical retry from a queue card) runs as a
      // fresh query; otherwise replay the last submission, preserving any
      // follow-up context carried in `promptText`.
      const last = lastSubmitRef.current;
      const target = text ?? last?.text ?? null;
      if (!target) return;
      // A fresh query keeps nothing; a replay keeps its project, context,
      // and funnel inputs.
      const opts: SubmitOptions = {
        ...(text ? {} : last?.opts),
        skipWebSearch,
      };
      if (isStreaming) {
        // Queue and let the effect below fire when the stream ends.
        pendingResumeRef.current = { text: target, opts };
        return;
      }
      void submit(target, opts);
    },
    [isStreaming, submit],
  );

  useEffect(() => {
    if (isStreaming) return;
    const pending = pendingResumeRef.current;
    if (!pending) return;
    pendingResumeRef.current = null;
    void submit(pending.text, pending.opts);
  }, [isStreaming, submit]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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
    stop,
  };
}
