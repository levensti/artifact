"use client";

import { MessageSquarePlus, StickyNote } from "lucide-react";

interface SelectionPopoverProps {
  rect: DOMRect;
  onAsk: () => void;
  onAnnotate: () => void;
}

export default function SelectionPopover({ rect, onAsk, onAnnotate }: SelectionPopoverProps) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const pad = 8;
  const centerX = rect.left + rect.width / 2;
  const left = Math.min(vw - pad, Math.max(pad, centerX));
  const top = Math.min(rect.bottom + 12, vh - 50);

  return (
    <div
      className="fixed z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 max-w-[calc(100vw-1rem)]"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        transform: "translateX(-50%)",
      }}
    >
      {/* Arrow */}
      <div
        className="absolute -top-[5px] left-1/2 -translate-x-1/2 size-2.5 rotate-45 bg-foreground"
        aria-hidden
      />
      <div className="relative flex items-center gap-0.5 rounded-full bg-foreground px-1 py-1 shadow-lg shadow-black/20">
        <button
          type="button"
          onClick={onAsk}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:bg-background/15"
        >
          <MessageSquarePlus size={13} strokeWidth={2} />
          Dive deeper
        </button>
        <div className="w-px h-4 bg-background/20" aria-hidden />
        <button
          type="button"
          onClick={onAnnotate}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:bg-background/15"
        >
          <StickyNote size={13} strokeWidth={2} />
          Add note
        </button>
      </div>
    </div>
  );
}
