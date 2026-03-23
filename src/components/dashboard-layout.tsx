"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar from "./sidebar";

const SIDEBAR_KEY = "paper-copilot-sidebar-collapsed";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === "true") setCollapsed(true);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
    </div>
  );
}
