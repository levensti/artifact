"use client";

import { MessageSquarePlus, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const top = Math.min(rect.bottom + 8, vh - 50);

  return (
    <div
      className="fixed z-50 animate-in fade-in slide-in-from-bottom-1 duration-150 max-w-[calc(100vw-1rem)]"
      style={{
        top: `${top}px`,
        left: `${left}px`,
        transform: "translateX(-50%)",
      }}
    >
      <div className="flex items-center gap-1 bg-card border border-border rounded-lg shadow-md shadow-slate-900/12 p-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={onAsk}
          className="gap-1.5 text-xs h-7 rounded-md px-2.5"
        >
          <MessageSquarePlus size={12} />
          Dive deeper
        </Button>
        <div className="w-px h-4 bg-border" />
        <Button
          size="sm"
          variant="ghost"
          onClick={onAnnotate}
          className="gap-1.5 text-xs h-7 rounded-md px-2.5"
        >
          <StickyNote size={12} />
          Add note
        </Button>
      </div>
    </div>
  );
}
