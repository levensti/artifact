"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MonoLabel } from "@/components/folio";
import { ExaKeyRow } from "@/components/exa-key-row";
import { OpenRouterKeyRow } from "@/components/openrouter-key-row";
import {
  hasAnySavedApiKey,
  hasPlatformOpenRouterKey,
  KEYS_UPDATED_EVENT,
} from "@/lib/keys";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({
  open,
  onOpenChange,
}: SettingsDialogProps) {
  // Header copy reflects current key state and updates on key changes.
  const [status, setStatus] = useState<"user" | "platform" | "none">("none");
  useEffect(() => {
    const recompute = () => {
      setStatus(
        hasAnySavedApiKey()
          ? "user"
          : hasPlatformOpenRouterKey()
            ? "platform"
            : "none",
      );
    };
    recompute();
    window.addEventListener(KEYS_UPDATED_EVENT, recompute);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, recompute);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(720px,min(90dvh,85vh))] w-[min(100vw-1rem,32rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-lg safe-area-p"
      >
        <DialogHeader className="shrink-0 border-b border-border/50 px-6 pt-6 pb-5 text-left">
          <MonoLabel>Settings</MonoLabel>
          <DialogTitle className="mt-2.5 text-[24px] font-bold leading-[1.1] tracking-[-0.025em]">
            Your API keys
          </DialogTitle>
          <DialogDescription
            className="mt-2 text-[13.5px] leading-[1.55]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
            }}
          >
            {status === "user"
              ? "Using your OpenRouter key."
              : status === "platform"
                ? "Artifact is covering AI costs while in early access."
                : "Add an OpenRouter key to start chatting."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-2.5 px-4 py-4">
            <h3 className="px-1 pb-0.5">
              <MonoLabel>Model provider</MonoLabel>
            </h3>
            <OpenRouterKeyRow />
            <div className="pt-3">
              <h3 className="px-1 pb-2.5">
                <MonoLabel>Search &amp; external tools</MonoLabel>
              </h3>
              <ExaKeyRow />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
