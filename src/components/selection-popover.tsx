"use client";

import { MessageSquarePlus } from "lucide-react";

interface SelectionPopoverProps {
  rect: DOMRect;
  onAsk: () => void;
}

export default function SelectionPopover({ rect, onAsk }: SelectionPopoverProps) {
  const left = rect.left + rect.width / 2;
  const top = Math.min(rect.bottom + 8, window.innerHeight - 50);

  return (
    <div
      className="fixed z-50"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        transform: "translateX(-50%)",
      }}
    >
      <button
        onClick={onAsk}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium shadow-[var(--shadow-lg)] hover:bg-accent-hover transition-colors border border-white/10"
      >
        <MessageSquarePlus size={12} />
        Ask about this
      </button>
    </div>
  );
}
