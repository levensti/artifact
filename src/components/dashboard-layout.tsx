"use client";

/* Hydration: localStorage / sessionStorage after mount (avoids SSR/client mismatch). */
/* eslint-disable react-hooks/set-state-in-effect */
import { Suspense, useCallback, useEffect, useState } from "react";
import type { Provider } from "@/lib/models";
import { PanelLeft } from "lucide-react";
import { cn, BREAKPOINTS } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Sidebar from "./sidebar";
import SettingsDialog from "./settings-dialog";
import { SettingsOpenerProvider } from "./settings-opener-context";
import DataHydration from "./data-hydration";

const SIDEBAR_KEY = "paper-copilot-sidebar-collapsed";
const OPEN_SETTINGS_FLAG = "paper-copilot-open-settings";

const NARROW_MQ = BREAKPOINTS.NARROW;

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [narrow, setNarrow] = useState(false);
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

  useEffect(() => {
    const mq = window.matchMedia(NARROW_MQ);
    setNarrow(mq.matches);
    const handler = () => setNarrow(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Auto-collapse sidebar when viewport becomes narrow
  useEffect(() => {
    const mq = window.matchMedia(NARROW_MQ);
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

  const showInlineSidebar = !narrow || collapsed;
  const showOverlaySidebar = narrow && !collapsed;

  return (
    <SettingsOpenerProvider openSettings={openSettings}>
      <DataHydration />
      <div className="relative flex h-full overflow-hidden">
        {showInlineSidebar && (
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
              presentation="inline"
            />
          </Suspense>
        )}
        {showOverlaySidebar && (
          <>
            <div
              className="fixed inset-0 z-30 bg-black/40"
              aria-hidden
              onClick={toggle}
            />
            <Suspense
              fallback={
                <aside
                  className="fixed inset-y-0 left-0 z-40 w-[min(272px,85vw)] bg-sidebar border-r border-sidebar-border"
                  aria-hidden
                />
              }
            >
              <Sidebar
                collapsed={false}
                presentation="overlay"
                />
            </Suspense>
          </>
        )}
        {collapsed && !narrow && (
          <div className="flex h-full w-11 shrink-0 flex-col items-center border-r border-border bg-background pt-2 safe-area-x">
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
        <main className="relative flex-1 min-w-0 overflow-hidden animate-page-enter">
          {narrow && collapsed && (
            <Button
              variant="outline"
              size="icon"
              className="fixed left-2 top-[max(0.5rem,env(safe-area-inset-top,0px))] z-20 size-8 border-border bg-background/90 shadow-sm backdrop-blur"
              onClick={toggle}
              title="Open sidebar"
              aria-label="Open sidebar"
            >
              <PanelLeft size={14} />
            </Button>
          )}
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
