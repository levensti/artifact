"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  Eye,
  EyeOff,
  Globe,
  Key,
  Trash2,
} from "lucide-react";
import {
  clearExaApiKey,
  getExaApiKey,
  hasPlatformExaKey,
  KEYS_UPDATED_EVENT,
  setExaApiKey,
} from "@/lib/keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Settings row for the Exa API key. Mirrors the structure and styling of
 * `ProviderRow` so it slots into the Settings dialog cleanly.
 *
 * Exa isn't a model provider — it backs the chat agent's `web_search`
 * tool. When this row has a key configured, web_search executes against
 * Exa; without a key, the tool returns a sentinel and the UI prompts.
 */
export function ExaKeyRow() {
  const [stored, setStored] = useState(() => getExaApiKey() ?? "");
  const [value, setValue] = useState(() => getExaApiKey() ?? "");
  const [platformKey, setPlatformKey] = useState(() => hasPlatformExaKey());
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimeoutRef = useRef<number | null>(null);

  const hasKey = !!stored;
  const usingPlatformKey = !hasKey && platformKey;
  const dirty = value.trim() !== stored.trim();

  useEffect(() => {
    const sync = () => {
      const next = getExaApiKey() ?? "";
      setStored(next);
      setValue(next);
      setPlatformKey(hasPlatformExaKey());
    };
    sync();
    window.addEventListener(KEYS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, sync);
  }, []);

  useEffect(
    () => () => {
      if (confirmTimeoutRef.current)
        window.clearTimeout(confirmTimeoutRef.current);
    },
    [],
  );

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed || !dirty) return;
    void setExaApiKey(trimmed).then(() => {
      setStored(trimmed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const handleClear = () => {
    if (confirmingDelete) {
      if (confirmTimeoutRef.current)
        window.clearTimeout(confirmTimeoutRef.current);
      setConfirmingDelete(false);
      void clearExaApiKey().then(() => {
        setStored("");
        setValue("");
        setVisible(false);
      });
      return;
    }
    setConfirmingDelete(true);
    confirmTimeoutRef.current = window.setTimeout(() => {
      setConfirmingDelete(false);
    }, 2500);
  };

  return (
    <div
      data-settings-tool="exa_search"
      className="rounded-xl border border-border/60 bg-card transition-all duration-200"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Globe size={15} strokeWidth={1.8} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold tracking-[-0.005em] text-foreground">
            Exa
          </p>
          <p
            className="truncate text-[12px] leading-snug"
            style={{
              fontFamily: "var(--font-reading)",
              color: hasKey
                ? "color-mix(in srgb, var(--success) 80%, transparent)"
                : usingPlatformKey
                  ? "color-mix(in srgb, var(--primary) 80%, transparent)"
                  : "color-mix(in srgb, var(--muted-foreground) 80%, transparent)",
            }}
          >
            {hasKey
              ? "Web search enabled"
              : usingPlatformKey
                ? "Covered by Artifact during early access"
                : "Web search off"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasKey ? (
            <CircleCheck size={16} className="text-success" strokeWidth={2} />
          ) : usingPlatformKey ? (
            <CircleCheck
              size={16}
              className="text-primary/70"
              strokeWidth={2}
            />
          ) : (
            <Circle
              size={16}
              className="text-muted-foreground/30"
              strokeWidth={1.5}
            />
          )}
          <ChevronDown
            size={14}
            className={cn(
              "text-muted-foreground/50 transition-transform duration-150",
              expanded && "rotate-180",
            )}
            strokeWidth={2}
          />
        </div>
      </button>

      <div
        className={cn(
          "grid transition-all duration-200 ease-out",
          expanded
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3.5 pt-0.5 space-y-2">
            <p
              className="text-[11.5px] leading-relaxed"
              style={{
                fontFamily: "var(--font-reading)",
                color:
                  "color-mix(in srgb, var(--muted-foreground) 85%, transparent)",
              }}
            ></p>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 relative min-w-0">
                <Key
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none"
                />
                <Input
                  type={visible ? "text" : "password"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Your Exa API key"
                  className="pl-8 pr-9 text-xs h-9"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                  }}
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={visible ? "Hide key" : "Show key"}
                >
                  {visible ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  onClick={handleSave}
                  disabled={!value.trim() || !dirty}
                  variant={saved ? "outline" : "default"}
                  size="sm"
                  className={
                    saved
                      ? "text-success border-success/35 gap-1 h-9"
                      : "h-9 gap-1"
                  }
                >
                  {saved && <Check size={13} />}
                  {saved ? "Saved" : hasKey ? "Replace" : "Save"}
                </Button>
                {hasKey && (
                  <button
                    type="button"
                    onClick={handleClear}
                    onBlur={() => {
                      if (confirmTimeoutRef.current)
                        window.clearTimeout(confirmTimeoutRef.current);
                      setConfirmingDelete(false);
                    }}
                    className={cn(
                      "flex items-center justify-center size-9 shrink-0 rounded-md transition-colors",
                      confirmingDelete
                        ? "border border-destructive bg-destructive text-destructive-foreground"
                        : "border border-destructive/25 bg-destructive/5 text-destructive/70 hover:text-destructive hover:bg-destructive/15",
                    )}
                    title={
                      confirmingDelete ? "Click again to confirm" : "Remove key"
                    }
                    aria-label={
                      confirmingDelete ? "Click again to confirm" : "Remove key"
                    }
                  >
                    {confirmingDelete ? (
                      <Check size={14} />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
