"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Mic, MicOff, Square } from "lucide-react";
import { useSpeechInput } from "@/hooks/use-speech-input";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  ResearchComposer — the research kickoff input                      */
/* ------------------------------------------------------------------ */

export default function ResearchComposer({
  disabled,
  isStreaming,
  hint,
  onSubmit,
  autoFocus = false,
}: {
  disabled: boolean;
  isStreaming: boolean;
  hint: string;
  onSubmit: (text: string) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSend = !disabled && !isStreaming && text.trim().length > 0;
  const inert = disabled || isStreaming;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const MAX = 160;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX ? "auto" : "hidden";
  }, [text]);

  const dictation = useSpeechInput(setText);
  const { listening, stop: stopDictation } = dictation;
  useEffect(() => {
    if (inert && listening) stopDictation();
  }, [inert, listening, stopDictation]);

  const send = useCallback(() => {
    if (!canSend) return;
    stopDictation();
    const trimmed = text.trim();
    setText("");
    onSubmit(trimmed);
  }, [canSend, text, onSubmit, stopDictation]);

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <div
      className={cn(
        "flex items-end rounded-lg border bg-card transition-colors",
        disabled
          ? "border-border/50 opacity-60"
          : isStreaming
            ? "border-border/50 opacity-90"
            : "border-border focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/15",
      )}
      style={{ boxShadow: disabled ? undefined : "var(--shadow-sm)" }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          // Typing takes over from dictation; otherwise the next interim
          // result would overwrite the edit.
          if (listening) stopDictation();
          setText(e.target.value);
        }}
        onKeyDown={onKey}
        placeholder={listening ? "Listening…" : hint}
        rows={1}
        disabled={inert}
        autoFocus={autoFocus}
        className="block max-h-40 min-w-0 flex-1 resize-none bg-transparent py-[9px] pl-3 pr-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
      />
      <div className="m-[5px] flex shrink-0 items-center gap-1">
        {dictation.supported && (
          <button
            type="button"
            onClick={() => (listening ? stopDictation() : dictation.start(text))}
            disabled={inert}
            aria-pressed={listening}
            aria-label={
              listening
                ? "Stop dictation"
                : dictation.error === "blocked"
                  ? "Microphone access is blocked"
                  : "Dictate"
            }
            title={
              listening
                ? "Stop dictation"
                : dictation.error === "blocked"
                  ? "Microphone access is blocked. Allow it in your browser's site settings."
                  : "Dictate"
            }
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              listening
                ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {listening ? (
              <Square className="size-3 animate-pulse fill-current" />
            ) : dictation.error === "blocked" ? (
              <MicOff className="size-3.5" />
            ) : (
              <Mic className="size-3.5" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label="Research"
          title="Research"
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md transition-colors",
            canSend
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "cursor-default bg-muted text-muted-foreground/60",
          )}
        >
          <ArrowUp className="size-3.5" strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
