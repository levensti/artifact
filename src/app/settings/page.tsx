"use client";

import { useState, useEffect } from "react";
import {
  Eye,
  EyeOff,
  Check,
  ExternalLink,
  Key,
  Shield,
} from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import { getApiKey, setApiKey, clearApiKey } from "@/lib/keys";
import { PROVIDER_META, type Provider } from "@/lib/models";
import { cn } from "@/lib/utils";

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
    <div className="rounded-xl border border-border bg-bg-secondary p-5 space-y-4">
      {/* Provider Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{meta.label}</h3>
            {hasKey && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-success-muted text-success text-[10px] font-medium">
                <div className="w-1 h-1 rounded-full bg-success" />
                Connected
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted leading-relaxed max-w-sm">
            {meta.description}
          </p>
        </div>
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
        >
          Get API key
          <ExternalLink size={10} />
        </a>
      </div>

      {/* Key Input */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-text-secondary">
          API Key
        </label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Key
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              type={visible ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-bg-primary border border-border rounded-lg pl-9 pr-10 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus transition-all font-mono"
            />
            <button
              onClick={() => setVisible(!visible)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
              aria-label={visible ? "Hide key" : "Show key"}
            >
              {visible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={!value.trim()}
            className={cn(
              "px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 shrink-0",
              saved
                ? "bg-success-muted text-success"
                : "bg-accent hover:bg-accent-hover text-white disabled:opacity-30 disabled:cursor-not-allowed",
            )}
          >
            {saved ? <Check size={14} /> : null}
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {/* Clear */}
      {hasKey && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-text-muted">
            Key stored in browser localStorage
          </span>
          <button
            onClick={handleClear}
            className="text-xs text-text-muted hover:text-danger transition-colors"
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
        <div className="max-w-2xl mx-auto px-6 py-10">
          {/* Page Header */}
          <div className="space-y-1 mb-8">
            <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
            <p className="text-sm text-text-muted">
              Manage your API keys and preferences
            </p>
          </div>

          {/* API Keys Section */}
          <section className="space-y-5">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-accent-muted flex items-center justify-center">
                <Key size={14} className="text-accent" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">API Keys</h2>
                <p className="text-xs text-text-muted">
                  Connect your AI provider accounts to use Paper Copilot
                </p>
              </div>
            </div>

            {/* Security Notice */}
            <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-accent-subtle border border-accent-muted">
              <Shield size={14} className="text-accent mt-0.5 shrink-0" />
              <div className="text-xs text-text-secondary leading-relaxed">
                <strong className="text-text-primary">How keys are handled.</strong>{" "}
                API keys are stored in your browser&apos;s localStorage. When you
                chat, keys are sent through this app&apos;s server-side proxy to
                call providers. Self-host this application for full control over
                key handling.
              </div>
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
