"use client";

import { useState, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Card chrome around a rendered diagram with a click-to-expand lightbox: the
 * chat side panel is narrow, so every visual can open in a large dialog. The
 * expand button is the accessible control; clicking the body is a pointer
 * shortcut.
 */
export default function DiagramFrame({
  title,
  className,
  children,
  expanded,
}: {
  /** Short name for the dialog title, e.g. the diagram's own title line. */
  title: string;
  /** Card class for the inline frame, e.g. "chat-diagram". */
  className: string;
  children: ReactNode;
  /** Content for the dialog; defaults to `children`. */
  expanded?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={`diagram-frame ${className}`}>
        <div className="diagram-frame-body" onClick={() => setOpen(true)}>
          {children}
        </div>
        <button
          type="button"
          className="diagram-expand-btn"
          aria-label={`Expand ${title}`}
          onClick={() => setOpen(true)}
        >
          <Maximize2 aria-hidden />
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-[min(92vw,1100px)]">
          <DialogTitle className="text-sm">{title}</DialogTitle>
          {expanded ?? children}
        </DialogContent>
      </Dialog>
    </>
  );
}
