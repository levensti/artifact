"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Check, ExternalLink, Key, Shield } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getApiKey, setApiKey, clearApiKey, KEYS_UPDATED_EVENT } from "@/lib/keys";
import { PROVIDER_META, type Provider } from "@/lib/models";

interface ProviderRowProps {
  provider: Provider;
  placeholder: string;
  docsUrl: string;
}

function ProviderRow({ provider, placeholder, docsUrl }: ProviderRowProps) {
  const meta = PROVIDER_META[provider];
  const [value, setValue] = useState(() => getApiKey(provider) ?? "");
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasKey, setHasKey] = useState(() => !!getApiKey(provider));

  useEffect(() => {
    const sync = () => {
      setValue(getApiKey(provider) ?? "");
      setHasKey(!!getApiKey(provider));
    };
    sync();
    window.addEventListener(KEYS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, sync);
  }, [provider]);

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    void setApiKey(provider, trimmed).then(() => {
      setHasKey(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const handleClear = () => {
    void clearApiKey(provider).then(() => {
      setValue("");
      setHasKey(false);
      setVisible(false);
    });
  };

  return (
    <div
      data-settings-provider={provider}
      className="rounded-xl border border-border/80 bg-card/80 p-3.5 space-y-3 transition-shadow duration-300"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold">{meta.label}</h3>
            {hasKey && (
              <Badge
                variant="outline"
                className="text-[10px] font-medium text-muted-foreground border-border gap-1 py-0 h-5"
              >
                Key saved
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-snug">
            {meta.description}
          </p>
        </div>
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center gap-1 text-xs text-primary/90 hover:text-primary transition-colors"
        >
          Get a key
          <ExternalLink size={10} />
        </a>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative min-w-0">
          <Key
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            type={visible ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="pl-8 pr-9 text-xs h-9"
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
              saved ? "text-primary border-primary/35 gap-1 h-9" : "h-9 gap-1"
            }
          >
            {saved && <Check size={13} />}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
      </div>

      {hasKey && (
        <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-border/60">
          <span className="text-[11px] text-muted-foreground/70">
            Stored in local SQLite on this machine
          </span>
          <button
            type="button"
            onClick={handleClear}
            className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focusProvider: Provider | null;
}

const FOCUS_RING_CLASS = "ring-2 ring-primary/35 shadow-sm";

export default function SettingsDialog({
  open,
  onOpenChange,
  focusProvider,
}: SettingsDialogProps) {
  useEffect(() => {
    if (!open || !focusProvider) return;

    const el = document.querySelector<HTMLElement>(
      `[data-settings-provider="${focusProvider}"]`,
    );
    if (!el) return;

    const scroll = () => {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      el.classList.add(...FOCUS_RING_CLASS.split(" "));
    };

    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(scroll);
    });

    const removeRing = window.setTimeout(() => {
      el.classList.remove(...FOCUS_RING_CLASS.split(" "));
    }, 2400);

    return () => {
      cancelAnimationFrame(raf1);
      window.clearTimeout(removeRing);
      el.classList.remove(...FOCUS_RING_CLASS.split(" "));
    };
  }, [open, focusProvider]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(560px,85vh)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 pt-4 pb-3 text-left">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Key size={16} className="text-primary" />
            </div>
            <div>
              <DialogTitle>Manage API keys</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Keys are stored in a local SQLite file on this machine. API
                calls use this app&apos;s server to reach Anthropic, OpenAI,
                xAI, or OpenRouter.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-start gap-2.5 rounded-lg border border-border/80 bg-muted/30 px-3 py-2.5">
              <Shield size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Values are stored in SQLite under this project&apos;s{" "}
                <code className="text-[10px]">data/</code> folder. Self-host the
                app if you need full control over where traffic goes.
              </p>
            </div>

            <ProviderRow
              provider="anthropic"
              placeholder="sk-ant-api03-..."
              docsUrl="https://console.anthropic.com/settings/keys"
            />
            <ProviderRow
              provider="openai"
              placeholder="sk-proj-..."
              docsUrl="https://platform.openai.com/api-keys"
            />
            <ProviderRow
              provider="xai"
              placeholder="xai-..."
              docsUrl="https://console.x.ai/"
            />
            <ProviderRow
              provider="openrouter"
              placeholder="sk-or-v1-..."
              docsUrl="https://openrouter.ai/keys"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
