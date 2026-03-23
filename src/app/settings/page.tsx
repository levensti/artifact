"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, Check, ExternalLink, Key, Shield } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getApiKey, setApiKey, clearApiKey } from "@/lib/keys";
import { PROVIDER_META, type Provider } from "@/lib/models";

interface ProviderCardProps {
  provider: Provider;
  placeholder: string;
  docsUrl: string;
}

function ProviderCard({ provider, placeholder, docsUrl }: ProviderCardProps) {
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
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      {/* Provider Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{meta.label}</h3>
            {hasKey && (
              <Badge variant="outline" className="text-[10px] font-medium text-emerald-500 border-emerald-500/30 gap-1 py-0 h-5">
                <div className="size-1 rounded-full bg-emerald-500" />
                Connected
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-sm">
            {meta.description}
          </p>
        </div>
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Get API key
          <ExternalLink size={10} />
        </a>
      </div>

      {/* Key Input */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          API Key
        </label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Key
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type={visible ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className="pl-9 pr-9 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={visible ? "Hide key" : "Show key"}
            >
              {visible ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <Button
            onClick={handleSave}
            disabled={!value.trim()}
            variant={saved ? "outline" : "default"}
            size="sm"
            className={saved ? "text-emerald-500 border-emerald-500/30 gap-1" : "gap-1"}
          >
            {saved && <Check size={13} />}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
      </div>

      {/* Clear */}
      {hasKey && (
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/60">
            Key stored in browser localStorage
          </span>
          <button
            onClick={handleClear}
            className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
          >
            Remove key
          </button>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <DashboardLayout>
      <div className="h-full overflow-auto">
        <div className="max-w-2xl mx-auto px-8 py-10">
          {/* Page Header */}
          <div className="space-y-1 mb-8">
            <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your API keys and preferences
            </p>
          </div>

          <Separator className="mb-8" />

          {/* API Keys Section */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Key size={14} className="text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">API Keys</h2>
                <p className="text-xs text-muted-foreground">
                  Connect your AI provider accounts to use Paper Copilot
                </p>
              </div>
            </div>

            {/* Security Notice */}
            <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-primary/5 border border-primary/10">
              <Shield size={13} className="text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground">How keys are handled.</strong>{" "}
                API keys are stored in your browser&apos;s localStorage. When you
                chat, keys are sent through this app&apos;s server-side proxy to
                call providers. Self-host this application for full control over
                key handling.
              </p>
            </div>

            {/* Provider Cards */}
            <div className="space-y-3">
              <ProviderCard
                provider="anthropic"
                placeholder="sk-ant-api03-..."
                docsUrl="https://console.anthropic.com/settings/keys"
              />
              <ProviderCard
                provider="openai"
                placeholder="sk-proj-..."
                docsUrl="https://platform.openai.com/api-keys"
              />
              <ProviderCard
                provider="openrouter"
                placeholder="sk-or-v1-..."
                docsUrl="https://openrouter.ai/keys"
              />
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
