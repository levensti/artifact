"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Provider } from "@/lib/models";

export type OpenSettingsOptions = { provider?: Provider };

type SettingsOpenerContextValue = {
  openSettings: (options?: OpenSettingsOptions) => void;
};

const SettingsOpenerContext = createContext<SettingsOpenerContextValue | null>(
  null,
);

export function SettingsOpenerProvider({
  children,
  openSettings,
}: {
  children: ReactNode;
  openSettings: (options?: OpenSettingsOptions) => void;
}) {
  return (
    <SettingsOpenerContext.Provider value={{ openSettings }}>
      {children}
    </SettingsOpenerContext.Provider>
  );
}

export function useSettingsOpener(): SettingsOpenerContextValue {
  const ctx = useContext(SettingsOpenerContext);
  if (!ctx) {
    throw new Error("useSettingsOpener must be used within SettingsOpenerProvider");
  }
  return ctx;
}

/**
 * Same as `useSettingsOpener`, but returns null when no provider is mounted.
 * Useful for components rendered both inside and outside the dashboard
 * shell (e.g. markdown rendered inside the wiki page chrome).
 */
export function useSettingsOpenerOptional(): SettingsOpenerContextValue | null {
  return useContext(SettingsOpenerContext);
}
