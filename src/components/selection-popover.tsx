"use client";

import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      <Button size="sm" onClick={onAsk} className="gap-1.5 shadow-md shadow-stone-900/15 text-xs h-8 rounded-lg px-3">
        <MessageSquarePlus size={12} />
        Ask about this
      </Button>
    </div>
  );
}
