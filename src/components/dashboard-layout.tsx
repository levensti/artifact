"use client";

/* Hydration: localStorage / sessionStorage after mount (avoids SSR/client mismatch). */
/* eslint-disable react-hooks/set-state-in-effect */
import { Suspense, useCallback, useEffect, useState } from "react";
import type { Provider } from "@/lib/models";
import { cn } from "@/lib/utils";
import Sidebar from "./sidebar";
import SettingsDialog from "./settings-dialog";
import CommandPalette from "./command-palette";
import { SettingsOpenerProvider } from "./settings-opener-context";
import DataHydration from "./data-hydration";

const SIDEBAR_KEY = "paper-copilot-sidebar-collapsed";
const OPEN_SETTINGS_FLAG = "paper-copilot-open-settings";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocusProvider, setSettingsFocusProvider] =
    useState<Provider | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(OPEN_SETTINGS_FLAG) === "1") {
        sessionStorage.removeItem(OPEN_SETTINGS_FLAG);
        setSettingsFocusProvider(null);
        setSettingsOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Cmd+K / Ctrl+K to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const openSettings = useCallback((options?: { provider?: Provider }) => {
    setSettingsFocusProvider(options?.provider ?? null);
    setSettingsOpen(true);
  }, []);

  const handleSettingsOpenChange = useCallback((open: boolean) => {
    setSettingsOpen(open);
    if (!open) setSettingsFocusProvider(null);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }, []);

  return (
    <SettingsOpenerProvider openSettings={openSettings}>
      <DataHydration />
      <div className="flex h-full overflow-hidden">
        <Suspense
          fallback={
            <aside
              className={cn(
                "flex flex-col h-full bg-sidebar border-r border-sidebar-border shrink-0 overflow-hidden",
                collapsed ? "w-0 border-r-0" : "w-[272px]",
              )}
              aria-hidden
            />
          }
        >
          <Sidebar
            collapsed={collapsed}
            onToggle={toggle}
            onOpenSettings={() => openSettings()}
            onOpenSearch={() => setSearchOpen(true)}
          />
        </Suspense>
        <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={handleSettingsOpenChange}
          focusProvider={settingsFocusProvider}
        />
        <CommandPalette
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
        />
      </div>
    </SettingsOpenerProvider>
  );
}
