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
      className="fixed z-50 animate-in fade-in slide-in-from-bottom-1 duration-150"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        transform: "translateX(-50%)",
      }}
    >
      <button
        onClick={onAsk}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium shadow-lg hover:bg-accent-hover transition-colors"
      >
        <MessageSquarePlus size={14} />
        Ask about this
      </button>
    </div>
  );
}
