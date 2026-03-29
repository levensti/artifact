"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

function TooltipProvider({
  children,
  delay = 100,
}: {
  children: React.ReactNode;
  /** Opening delay for the first tooltip in a hover sequence (ms). */
  delay?: number;
}) {
  return (
    <TooltipPrimitive.Provider delay={delay} closeDelay={0}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

interface TextTooltipProps {
  /** Full string shown in the floating panel (and used for `aria-label`). */
  label: string;
  /** Visible truncated content; defaults to `label`. */
  children?: React.ReactNode;
  /** Classes merged onto the in-row trigger (usually a truncated span). */
  triggerClassName?: string;
  side?: "top" | "right" | "bottom" | "left";
  contentClassName?: string;
}

/**
 * Fast hover tooltip for truncated labels (sidebar review titles, etc.).
 */
function TextTooltip({
  label,
  children,
  triggerClassName,
  side = "right",
  contentClassName,
}: TextTooltipProps) {
  const visible = children ?? label;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger
        delay={100}
        closeDelay={0}
        render={
          <span
            className={cn(
              "min-w-0 flex-1 cursor-inherit truncate text-left outline-none",
              triggerClassName,
            )}
          />
        }
        aria-label={label}
      >
        {visible}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side={side}
          align="start"
          sideOffset={8}
          className="z-100"
        >
          <TooltipPrimitive.Popup
            className={cn(
              "max-w-[min(90vw,20rem)] origin-(--transform-origin) rounded-md border border-border/80 bg-popover px-2.5 py-1.5 text-xs leading-snug text-popover-foreground shadow-md",
              "ring-1 ring-foreground/5",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:duration-100",
              "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-75",
              contentClassName,
            )}
          >
            {label}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { TooltipProvider, TextTooltip };
