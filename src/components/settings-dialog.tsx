"use client";

import { useEffect, useState, type ReactNode } from "react";
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
import { UsageAllowanceRow } from "@/components/usage-allowance-row";
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
  const [tab, setTab] = useState<"keys" | "usage">("usage");
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
            Account settings
          </DialogTitle>
          <DialogDescription
            className="mt-2 text-[13.5px] leading-[1.55]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
            }}
          >
            {status === "user"
              ? "Artifact taps into free, platform-provided usage first, then taps into your own key."
              : status === "platform"
                ? "Artifact covers a free daily allowance. Add your own key to get unmetered usage."
                : "Add your own key to get unmetered usage."}
          </DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 border-b border-border/50 bg-muted/25 px-4 py-2"
        >
          <SettingsTab
            active={tab === "usage"}
            onClick={() => setTab("usage")}
          >
            Usage
          </SettingsTab>
          <SettingsTab
            active={tab === "keys"}
            onClick={() => setTab("keys")}
          >
            API keys
          </SettingsTab>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {tab === "keys" ? (
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
          ) : (
            <div className="space-y-2.5 px-4 py-4">
              <h3 className="px-1 pb-0.5">
                <MonoLabel>Allowance</MonoLabel>
              </h3>
              <UsageAllowanceRow active={open && tab === "usage"} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsTab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? "rounded-md bg-background px-3 py-1.5 text-[12.5px] font-medium text-foreground shadow-sm"
          : "rounded-md px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}
