"use client";

/**
 * Project-level chat panel — minimal cross-paper Q&A.
 *
 * Standalone from `chat-panel.tsx` because that one is heavily coupled
 * to a single review (annotations, parsedPaper, quote-in-reply). This
 * panel renders a flat message thread and streams the project chat
 * endpoint. Tool calls (arxiv_search / web_search) are rendered as
 * compact chips inline with the assistant text.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, Search, Send, Sparkles } from "lucide-react";
import type { ChatMessage, ChatAssistantBlock } from "@/lib/review-types";
import type { Model } from "@/lib/models";
import type { StreamEvent } from "@/lib/stream-types";
import { resolveModelCredentials, getBraveSearchApiKey } from "@/lib/keys";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import ModelSelector from "./model-selector";
import MarkdownMessage from "./markdown-message";

interface ProjectChatPanelProps {
  projectId: string;
  projectName: string;
  /// Lifted so the parent can persist the selection across project
  /// switches; falls back to a local `useState` if not provided.
  selectedModel: Model | null;
  onModelChange: (m: Model | null) => void;
}

interface ToolChip {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
}

/// While streaming, accumulate text + tool chips together so the UI
/// can render them in order. On stream end we collapse this into a
/// `ChatMessage` with `blocks`.
type StreamingPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; chip: ToolChip };

export default function ProjectChatPanel({
  projectId,
  projectName,
  selectedModel,
  onModelChange,
}: ProjectChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<StreamingPart[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Load persisted history on mount / project change. Reset everything
  // else: a half-typed input doesn't carry across projects.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setMessages([]);
    setStreaming([]);
    setInput("");
    setError(null);
    void (async () => {
      try {
        const { messages: list } = await apiFetch<{ messages: ChatMessage[] }>(
          `/api/projects/${encodeURIComponent(projectId)}/messages`,
        );
        if (cancelled) return;
        setMessages(list ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load chat history",
        );
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [projectId]);

  // Auto-scroll to the bottom on new content. Use `scrollHeight` so we
  // also follow streaming text growth.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const persist = useCallback(
    async (next: ChatMessage[]) => {
      try {
        await apiFetch(
          `/api/projects/${encodeURIComponent(projectId)}/messages`,
          { method: "PUT", body: { messages: next } },
        );
      } catch (err) {
        // Persistence failure shouldn't kill the in-memory thread —
        // surface it but keep the UI responsive.
        setError(
          err instanceof Error ? err.message : "Failed to save message",
        );
      }
    },
    [projectId],
  );

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!selectedModel) {
      setError("Pick a model first.");
      return;
    }
    const creds = resolveModelCredentials(selectedModel);
    if (!creds) {
      setError(
        "This model isn't ready — open Settings to add an API key or finish a profile.",
      );
      return;
    }

    setError(null);
    const now = new Date().toISOString();
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: now,
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setStreaming([]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // Wire payload: history excluding the empty assistant turn we'll
    // build from the stream. The agent loop expects role + content.
    const payload = {
      messages: nextHistory.map((m) => ({ role: m.role, content: m.content })),
      model: selectedModel.modelId,
      provider: selectedModel.provider,
      apiKey: creds.apiKey,
      apiBaseUrl: creds.apiBaseUrl,
      supportsStreaming: creds.supportsStreaming,
      braveSearchApiKey: getBraveSearchApiKey() ?? undefined,
    };

    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );
      if (!res.ok || !res.body) {
        const errBody = await res
          .json()
          .catch(() => ({ error: "Stream failed" }));
        throw new Error(errBody?.error ?? "Stream failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const parts: StreamingPart[] = [];

      const handleEvent = (evt: StreamEvent) => {
        if (evt.type === "text_delta") {
          const last = parts[parts.length - 1];
          if (last && last.kind === "text") {
            last.text += evt.text;
          } else {
            parts.push({ kind: "text", text: evt.text });
          }
        } else if (evt.type === "tool_call") {
          parts.push({
            kind: "tool",
            chip: { id: evt.id, name: evt.name, input: evt.input },
          });
        } else if (evt.type === "tool_result") {
          // Attach output to the most-recent matching tool chip.
          for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            if (p.kind === "tool" && p.chip.id === evt.id) {
              p.chip.output = evt.output;
              break;
            }
          }
        } else if (evt.type === "error") {
          setError(evt.message);
        }
        // Snapshot into state so React re-renders. Cheap because parts
        // is small for typical turns.
        setStreaming([...parts]);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          try {
            handleEvent(JSON.parse(t) as StreamEvent);
          } catch {
            /* skip malformed */
          }
        }
      }
      if (buf.trim()) {
        try {
          handleEvent(JSON.parse(buf.trim()) as StreamEvent);
        } catch {
          /* ignore */
        }
      }

      // Collapse parts into a stored ChatMessage. blocks[] preserves
      // tool-call ordering for replay.
      const blocks: ChatAssistantBlock[] = parts.map((p) =>
        p.kind === "text"
          ? { type: "text_segment" as const, content: p.text }
          : {
              type: "tool_call" as const,
              id: p.chip.id,
              name: p.chip.name,
              input: p.chip.input,
              output: p.chip.output,
            },
      );
      const assistantText = parts
        .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
        .map((p) => p.text)
        .join("");
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: assistantText,
        timestamp: new Date().toISOString(),
        blocks,
      };
      const finalHistory = [...nextHistory, assistantMsg];
      setMessages(finalHistory);
      setStreaming([]);
      void persist(finalHistory);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // User stopped the stream — keep partial text in state if any.
        return;
      }
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      void send();
    }
  };

  const noKey = useMemo(
    () => selectedModel && !resolveModelCredentials(selectedModel),
    [selectedModel],
  );

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-foreground/80">
          <Sparkles
            className="size-3.5 text-primary/70"
            strokeWidth={1.75}
          />
          Ask across {projectName}
        </div>
        <ModelSelector selected={selectedModel} onSelect={onModelChange} />
      </div>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-3 py-3 [scroll-padding-bottom:1rem]"
      >
        {!loaded ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-2 size-3.5 animate-spin" /> Loading…
          </div>
        ) : messages.length === 0 && streaming.length === 0 ? (
          <div className="mx-auto max-w-md py-6 text-center">
            <p className="text-[13px] font-medium text-foreground/85">
              Ask a question that spans the project
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground/80">
              The assistant has the list of papers in this project. It can
              search arXiv and the web for context. For deep section-level
              detail, open the paper directly.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {streaming.length > 0 ? (
              <StreamingBubble parts={streaming} />
            ) : null}
            {busy && streaming.length === 0 ? (
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Thinking…
              </div>
            ) : null}
          </div>
        )}
      </div>

      {error ? (
        <div className="border-t border-destructive/20 bg-destructive/5 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      ) : null}

      <div className="border-t border-border/70 p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            placeholder={
              noKey
                ? "Add an API key in Settings to chat…"
                : "Ask anything about these papers…"
            }
            rows={2}
            className={cn(
              "flex min-h-[40px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none transition placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring/40",
              busy && "opacity-60",
            )}
          />
          {busy ? (
            <Button
              onClick={() => abortRef.current?.abort()}
              size="icon-sm"
              variant="outline"
              title="Stop"
            >
              <span className="block size-2 rounded-sm bg-foreground/70" />
            </Button>
          ) : (
            <Button
              onClick={send}
              disabled={!input.trim() || !selectedModel}
              size="icon-sm"
              title="Send"
            >
              <Send className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-primary px-3 py-1.5 text-[13px] text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex max-w-full flex-col gap-1.5 text-[13px]">
      {(message.blocks ?? [
        { type: "text_segment" as const, content: message.content },
      ]).map((b, i) => {
        if (b.type === "text_segment") {
          return (
            <div key={i} className="prose-sm max-w-none text-foreground/90">
              <MarkdownMessage content={b.content} />
            </div>
          );
        }
        if (b.type === "tool_call") {
          return <ToolCallChip key={i} name={b.name} input={b.input} />;
        }
        return null;
      })}
    </div>
  );
}

function StreamingBubble({ parts }: { parts: StreamingPart[] }) {
  return (
    <div className="flex max-w-full flex-col gap-1.5 text-[13px]">
      {parts.map((p, i) =>
        p.kind === "text" ? (
          <div key={i} className="prose-sm max-w-none text-foreground/90">
            <MarkdownMessage content={p.text} />
          </div>
        ) : (
          <ToolCallChip key={i} name={p.chip.name} input={p.chip.input} />
        ),
      )}
    </div>
  );
}

function ToolCallChip({
  name,
  input,
}: {
  name: string;
  input: Record<string, unknown>;
}) {
  // Show the tool name and a one-line summary of the input. Avoids a
  // wall of JSON in the chat thread.
  const summary = summarizeToolInput(name, input);
  return (
    <div className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
      <Search className="size-3 shrink-0" strokeWidth={1.75} />
      <span className="truncate">
        <span className="font-medium text-foreground/80">{name}</span>
        {summary ? <span className="opacity-80"> · {summary}</span> : null}
      </span>
    </div>
  );
}

function summarizeToolInput(
  name: string,
  input: Record<string, unknown>,
): string | null {
  if (typeof input?.query === "string") return String(input.query);
  if (typeof input?.url === "string") return String(input.url);
  // Heuristic: prefer the first short string-valued field.
  for (const v of Object.values(input ?? {})) {
    if (typeof v === "string" && v.length < 120) return v;
  }
  void name;
  return null;
}
