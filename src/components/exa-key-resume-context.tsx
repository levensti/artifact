"use client";

import { createContext, useContext, type ReactNode } from "react";

interface ExaKeyResumeContextValue {
  /**
   * Re-run the chat agent. Called by the inline "Enable web search" card
   * after the user added a key (`skipWebSearch: false`) or dismissed the
   * prompt (`skipWebSearch: true`). When `text` is provided, that query
   * runs instead of the most recent one — used by the queue's persistent
   * card so resumes target the originally-failed query, not whatever the
   * user typed since.
   */
  resumeAfterExaDecision: (opts: {
    skipWebSearch: boolean;
    text?: string;
  }) => void;
}

const Ctx = createContext<ExaKeyResumeContextValue | null>(null);

export function ExaKeyResumeProvider({
  resumeAfterExaDecision,
  children,
}: ExaKeyResumeContextValue & { children: ReactNode }) {
  return (
    <Ctx.Provider value={{ resumeAfterExaDecision }}>{children}</Ctx.Provider>
  );
}

export function useExaKeyResumeOptional(): ExaKeyResumeContextValue | null {
  return useContext(Ctx);
}
