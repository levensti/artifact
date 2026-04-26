"use client";

import { createContext, useContext, type ReactNode } from "react";

interface BraveKeyResumeContextValue {
  /**
   * Re-run the chat agent on the user's last message. Called by the inline
   * "Enable web search" card after the user either added a key (`skipWebSearch:
   * false`) or dismissed the prompt (`skipWebSearch: true`).
   */
  resumeAfterBraveDecision: (opts: { skipWebSearch: boolean }) => void;
}

const Ctx = createContext<BraveKeyResumeContextValue | null>(null);

export function BraveKeyResumeProvider({
  resumeAfterBraveDecision,
  children,
}: BraveKeyResumeContextValue & { children: ReactNode }) {
  return (
    <Ctx.Provider value={{ resumeAfterBraveDecision }}>{children}</Ctx.Provider>
  );
}

export function useBraveKeyResumeOptional(): BraveKeyResumeContextValue | null {
  return useContext(Ctx);
}
