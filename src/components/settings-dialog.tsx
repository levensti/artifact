"use client";

import { useState, useEffect } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { getApiKey, setApiKey, clearApiKey } from "@/lib/keys";
import { PROVIDER_META, type Provider } from "@/lib/models";

interface ProviderRowProps {
  provider: Provider;
  placeholder: string;
  docsUrl: string;
}

function ProviderRow({ provider, placeholder, docsUrl }: ProviderRowProps) {
  const meta = PROVIDER_META[provider];
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    const existing = getApiKey(provider);
    if (existing) {
      setValue(existing);
      setHasKey(true);
    }
  }, [provider]);

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setApiKey(provider, trimmed);
    setHasKey(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    clearApiKey(provider);
    setValue("");
    setHasKey(false);
    setVisible(false);
  };

  return (
    <div className="rounded-xl border border-border/80 bg-card/80 p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold">{meta.label}</h3>
            {hasKey && (
              <Badge
                variant="outline"
                className="text-[10px] font-medium text-primary border-primary/30 gap-1 py-0 h-5"
              >
                <span className="size-1 rounded-full bg-primary" />
                Connected
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
          Keys
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
            className="pl-8 pr-9 font-mono text-xs h-9"
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
            className={saved ? "text-primary border-primary/35 gap-1 h-9" : "h-9 gap-1"}
          >
            {saved && <Check size={13} />}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
      </div>

      {hasKey && (
        <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-border/60">
          <span className="text-[11px] text-muted-foreground/70">
            Stored in this browser only
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
}

export default function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="sm:max-w-lg max-h-[min(560px,85vh)] p-0 gap-0 flex flex-col overflow-hidden"
      >
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/70 shrink-0 text-left">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Key size={16} className="text-primary" />
            </div>
            <div>
              <DialogTitle>API keys</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Bring your own keys — nothing is stored on our servers except in transit to the provider.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 max-h-[min(420px,60vh)]">
          <div className="px-4 py-3 space-y-3">
            <div className="flex items-start gap-2.5 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2.5">
              <Shield size={14} className="text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground">Privacy.</span> Keys live in
                your browser (localStorage). Chat requests go through this app&apos;s server
                to call Anthropic / OpenAI / OpenRouter. Self-host for full control.
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
              provider="openrouter"
              placeholder="sk-or-v1-..."
              docsUrl="https://openrouter.ai/keys"
            />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
