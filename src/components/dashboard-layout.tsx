"use client";

/* Hydration: localStorage / sessionStorage after mount (avoids SSR/client mismatch). */
/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import type { Provider } from "@/lib/models";
import Sidebar from "./sidebar";
import SettingsDialog from "./settings-dialog";
import { SettingsOpenerProvider } from "./settings-opener-context";

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
      <div className="flex h-full overflow-hidden">
        <Sidebar
          collapsed={collapsed}
          onToggle={toggle}
          onOpenSettings={() => openSettings()}
        />
        <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={handleSettingsOpenChange}
          focusProvider={settingsFocusProvider}
        />
      </div>
    </SettingsOpenerProvider>
  );
}
