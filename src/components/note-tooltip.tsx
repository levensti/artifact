"use client";

import { useEffect, useRef } from "react";
import type { Annotation } from "@/lib/annotations";

interface NoteTooltipProps {
  annotation: Annotation;
  position: { x: number; y: number };
  onClose: () => void;
  /** Focus the comment thread in the sidebar */
  onFocusThread: () => void;
}

export default function NoteTooltip({
  annotation,
  position,
  onClose,
  onFocusThread,
}: NoteTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => window.addEventListener("mousedown", handle), 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handle);
    };
  }, [onClose]);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose]);

  const top = Math.min(position.y + 4, window.innerHeight - 120);
  const left = Math.min(position.x, window.innerWidth - 260);

  return (
    <div
      ref={ref}
      className="fixed z-50 animate-in fade-in slide-in-from-bottom-1 duration-100"
      style={{ top: `${top}px`, left: `${left}px` }}
    >
      <div className="w-56 bg-card border border-border rounded-lg shadow-md shadow-stone-900/10 overflow-hidden">
        {annotation.note ? (
          <p className="px-3 py-2.5 text-sm text-foreground leading-relaxed line-clamp-4">
            {annotation.note}
          </p>
        ) : (
          <p className="px-3 py-2.5 text-sm text-muted-foreground italic">
            No note yet
          </p>
        )}
        <div className="border-t border-border px-3 py-1.5">
          <button
            type="button"
            onClick={onFocusThread}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {annotation.note ? "Edit comment" : "Add comment"} &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
