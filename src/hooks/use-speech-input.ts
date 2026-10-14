"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// The DOM lib ships the result types but not the recognizer itself, which
// Chrome and Safari still expose only as `webkitSpeechRecognition`.
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognizerCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

export type SpeechInputError = "blocked" | "failed";

/**
 * Browser dictation via the Web Speech API. `start(base)` appends what the
 * user says to `base`, calling `onText` with the full composed value as
 * interim results stream in, so the transcript shows up in the textarea
 * live. `supported` is false on Firefox and during SSR; callers hide the
 * control then.
 */
export function useSpeechInput(onText: (text: string) => void) {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => recognizerCtor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<SpeechInputError | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback((base: string) => {
    const Ctor = recognizerCtor();
    if (!Ctor || recognitionRef.current) return;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    const prefix = base && !/\s$/.test(base) ? `${base} ` : base;
    recognition.onresult = (e) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      onTextRef.current(prefix + transcript.trimStart());
    };
    recognition.onerror = (e) => {
      // "no-speech" and "aborted" are normal endings, not failures.
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "blocked" : "failed");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    setError(null);
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setError("failed");
    }
  }, []);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  return { supported, listening, error, start, stop };
}
