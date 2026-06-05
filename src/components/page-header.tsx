"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Page name — the page's single h1, shown large and in-canvas. */
  title: string;
  /** Right-aligned page actions: primary button, model pill, etc. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The shared in-canvas page header used across content pages (Discover,
 * Journal). Following the app-shell pattern most sidebar dashboards use: a
 * large page title on the left with the primary action on the same baseline to
 * the right, sitting inside the content column (not a separate chrome bar). The
 * page's prominent input (search / composer) goes directly beneath it. The
 * sidebar stays the app's only persistent chrome.
 */
export default function PageHeader({
  title,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <h1 className="text-[27px] font-semibold leading-tight tracking-[-0.022em] text-foreground">
        {title}
      </h1>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
