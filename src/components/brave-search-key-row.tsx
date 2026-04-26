"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Circle,
  CircleCheck,
  Eye,
  EyeOff,
  Globe,
  Key,
  Trash2,
} from "lucide-react";
import {
  clearBraveSearchApiKey,
  getBraveSearchApiKey,
  KEYS_UPDATED_EVENT,
  setBraveSearchApiKey,
} from "@/lib/keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Settings row for the Brave Search API key. Mirrors the structure and
 * styling of `ProviderRow` so it slots into the Settings dialog cleanly.
 *
 * Brave Search isn't a model provider — it backs the chat agent's
 * `web_search` tool. When this row has a key configured, the agent gets
 * `web_search` registered for the chat turn; without a key, it doesn't,
 * and the system prompt instructs the agent to be honest about that.
 */
export function BraveSearchKeyRow() {
  const [value, setValue] = useState(() => getBraveSearchApiKey() ?? "");
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasKey, setHasKey] = useState(() => !!getBraveSearchApiKey());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const sync = () => {
      setValue(getBraveSearchApiKey() ?? "");
      setHasKey(!!getBraveSearchApiKey());
    };
    sync();
    window.addEventListener(KEYS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, sync);
  }, []);

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    void setBraveSearchApiKey(trimmed).then(() => {
      setHasKey(true);
      setSaved(true);
      setExpanded(false);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const handleClear = () => {
    void clearBraveSearchApiKey().then(() => {
      setValue("");
      setHasKey(false);
      setVisible(false);
    });
  };

  return (
    <div
      data-settings-tool="brave_search"
      className="rounded-xl border border-border/60 bg-card transition-all duration-200"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Globe size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground">
            Brave Search
          </p>
          <p className="text-[11px] text-muted-foreground/60 truncate">
            {hasKey
              ? "Web search enabled"
              : "Web search off — add a key to let the agent ground answers"}
          </p>
        </div>
        {hasKey ? (
          <CircleCheck
            size={16}
            className="shrink-0 text-success"
            strokeWidth={2}
          />
        ) : (
          <Circle
            size={16}
            className="shrink-0 text-muted-foreground/30"
            strokeWidth={1.5}
          />
        )}
      </button>

      <div
        className={cn(
          "grid transition-all duration-200 ease-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3.5 pt-0.5 space-y-2.5">
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              Enables the chat agent&apos;s web search tool. Free tier (~2k
              queries/month) at{" "}
              <a
                href="https://brave.com/search/api/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-2 hover:underline"
              >
                brave.com/search/api
              </a>
              . Stored locally in your browser.
            </p>
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
                  placeholder="BSA..."
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
                  disabled={!value.trim()}
                  variant={saved ? "outline" : "default"}
                  size="sm"
                  className={
                    saved
                      ? "text-success border-success/35 gap-1 h-9"
                      : "h-9 gap-1"
                  }
                >
                  {saved && <Check size={13} />}
                  {saved ? "Saved" : "Save"}
                </Button>
                {hasKey && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="flex items-center justify-center size-9 shrink-0 rounded-md border border-destructive/25 bg-destructive/5 text-destructive/70 hover:text-destructive hover:bg-destructive/15 transition-colors"
                    title="Remove key"
                  >
                    <Trash2 size={14} />
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
