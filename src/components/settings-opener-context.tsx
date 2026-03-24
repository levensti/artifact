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
