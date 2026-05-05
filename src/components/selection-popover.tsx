"use client";

import { MessageSquarePlus, StickyNote } from "lucide-react";

interface SelectionPopoverProps {
  rect: DOMRect;
  onAsk: () => void;
  onAnnotate: () => void;
}

/**
 * Folio-style selection popover. Renders as a small "card" anchored to
 * the selected text, the way a marginalia tool would surface beside a
 * passage. The arrow + card share a hairline border so the whole thing
 * reads as a single object.
 */
export default function SelectionPopover({
  rect,
  onAsk,
  onAnnotate,
}: SelectionPopoverProps) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const pad = 8;
  const centerX = rect.left + rect.width / 2;
  const left = Math.min(vw - pad, Math.max(pad, centerX));
  const top = Math.min(rect.bottom + 12, vh - 50);

  return (
    <div
      className="fixed z-50 max-w-[calc(100vw-1rem)] animate-in fade-in slide-in-from-bottom-1 duration-150"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        transform: "translateX(-50%)",
      }}
    >
      {/* Arrow — shares the popover's border */}
      <div
        className="absolute -top-[5px] left-1/2 size-2.5 -translate-x-1/2 rotate-45"
        style={{
          background: "var(--card)",
          borderTop: "1px solid var(--border)",
          borderLeft: "1px solid var(--border)",
        }}
        aria-hidden
      />
      <div
        className="relative flex items-center gap-0.5 rounded-md border bg-card p-1 shadow-[var(--shadow-md)]"
        style={{ borderColor: "var(--border)" }}
      >
        <PopoverButton onClick={onAsk}>
          <MessageSquarePlus
            size={12}
            strokeWidth={2}
            style={{
              color: "color-mix(in srgb, var(--primary) 70%, transparent)",
            }}
          />
          Dive deeper
        </PopoverButton>
        <span
          className="h-4 w-px"
          style={{
            background:
              "color-mix(in srgb, var(--border) 80%, transparent)",
          }}
          aria-hidden
        />
        <PopoverButton onClick={onAnnotate}>
          <StickyNote
            size={12}
            strokeWidth={2}
            style={{
              color: "color-mix(in srgb, var(--primary) 70%, transparent)",
            }}
          />
          Add note
        </PopoverButton>
      </div>
    </div>
  );
}

function PopoverButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[11.5px] font-medium text-foreground transition-colors duration-150 hover:bg-muted"
      style={{ letterSpacing: "0.005em" }}
    >
      {children}
    </button>
  );
}
