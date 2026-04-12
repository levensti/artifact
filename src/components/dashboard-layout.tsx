"use client";

/* Hydration: localStorage / sessionStorage after mount (avoids SSR/client mismatch). */
/* eslint-disable react-hooks/set-state-in-effect */
import { Suspense, useCallback, useEffect, useState } from "react";
import type { Provider } from "@/lib/models";
import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Sidebar from "./sidebar";
import SettingsDialog from "./settings-dialog";
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

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === "true") {
      setCollapsed(true);
    } else if (window.innerWidth < 1024) {
      setCollapsed(true);
    }
  }, []);

  // Auto-collapse sidebar when viewport becomes narrow
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setCollapsed(true);
        localStorage.setItem(SIDEBAR_KEY, "true");
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
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
          />
        </Suspense>
        {collapsed && (
          <div className="flex h-14 shrink-0 items-center border-r border-border bg-background px-1.5">
            <Button
              variant="outline"
              size="icon"
              className="size-8 border-border"
              onClick={toggle}
              title="Expand sidebar"
            >
              <PanelLeft size={14} />
            </Button>
          </div>
        )}
        <main className="flex-1 min-w-0 overflow-hidden">
          {children}
        </main>
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={handleSettingsOpenChange}
          focusProvider={settingsFocusProvider}
        />
      </div>
    </SettingsOpenerProvider>
  );
}
