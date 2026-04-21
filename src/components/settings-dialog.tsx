"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Check, Key, Plus, Trash2, CircleCheck, Circle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  getInferenceProfiles,
  saveInferenceProfiles,
  KEYS_UPDATED_EVENT,
} from "@/lib/keys";
import type {
  InferenceProfileKind,
  InferenceProviderProfile,
  Provider,
} from "@/lib/models";
import { PROVIDER_META } from "@/lib/models";
import { cn } from "@/lib/utils";

type BuiltinSettingsProvider = keyof typeof PROVIDER_META;


interface ProviderRowProps {
  provider: BuiltinSettingsProvider;
  placeholder: string;
  docsUrl: string;
}

export function ProviderRow({ provider, placeholder }: ProviderRowProps) {
  const meta = PROVIDER_META[provider];
  const [value, setValue] = useState(() => getApiKey(provider) ?? "");
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasKey, setHasKey] = useState(() => !!getApiKey(provider));
  const [expanded, setExpanded] = useState(false);

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
      setExpanded(false);
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
      className="rounded-xl border border-border/60 bg-card transition-all duration-200"
    >
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] font-bold text-muted-foreground">
          {meta.label.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground">{meta.label}</p>
          <p className="text-[11px] text-muted-foreground/60 truncate">
            {hasKey ? "API key configured" : "No API key set"}
          </p>
        </div>
        {hasKey ? (
          <CircleCheck size={16} className="shrink-0 text-success" strokeWidth={2} />
        ) : (
          <Circle size={16} className="shrink-0 text-muted-foreground/30" strokeWidth={1.5} />
        )}
      </button>

      {/* Expandable key input */}
      <div
        className={cn(
          "grid transition-all duration-200 ease-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3.5 pt-0.5 space-y-2.5">
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
                  placeholder={placeholder}
                  className="pl-8 pr-9 text-xs h-9"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
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
                    saved ? "text-success border-success/35 gap-1 h-9" : "h-9 gap-1"
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

function InferenceProfileCard({
  profile,
  onUpdate,
  onRemove,
  basePlaceholder,
}: {
  profile: InferenceProviderProfile;
  onUpdate: (patch: Partial<InferenceProviderProfile>) => void;
  onRemove: () => void;
  basePlaceholder: string;
}) {
  const [label, setLabel] = useState(profile.label);
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl);
  const [apiKey, setApiKey] = useState(profile.apiKey);
  const [supportsStreaming, setSupportsStreaming] = useState(
    profile.supportsStreaming !== false,
  );
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLabel(profile.label);
    setBaseUrl(profile.baseUrl);
    setApiKey(profile.apiKey);
    setSupportsStreaming(profile.supportsStreaming !== false);
  }, [profile]);

  const [urlError, setUrlError] = useState("");

  const isValidUrl = (url: string): boolean => {
    try {
      const u = new URL(url);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  };

  const handleSave = () => {
    if (!isValidUrl(baseUrl.trim())) {
      setUrlError("Enter a valid URL (e.g. https://api.example.com/v1)");
      return;
    }
    setUrlError("");
    onUpdate({
      label: label.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      supportsStreaming,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div
      data-settings-profile={profile.id}
      className="rounded-lg border border-border/50 bg-background/50 p-3 space-y-2.5"
    >
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Provider name"
        className="text-xs h-8 font-medium"
        spellCheck={false}
      />

      <div className="space-y-1">
        <label className="text-[10px] font-medium text-muted-foreground/70">
          API base URL
        </label>
        <Input
          type="url"
          value={baseUrl}
          onChange={(e) => {
            setBaseUrl(e.target.value);
            setUrlError("");
          }}
          placeholder={basePlaceholder}
          className={`text-xs h-8${urlError ? " border-destructive" : ""}`}
          autoComplete="off"
          spellCheck={false}
        />
        {urlError && <p className="text-[10px] text-destructive">{urlError}</p>}
      </div>

      <div className="relative">
        <Key
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none"
        />
        <Input
          type={visible ? "text" : "password"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API key"
          className="pl-7 pr-8 text-xs h-8"
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-label={visible ? "Hide key" : "Show key"}
        >
          {visible ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </div>

      <label className="flex items-center gap-2 cursor-pointer pt-0.5">
        <input
          type="checkbox"
          checked={supportsStreaming}
          onChange={(e) => setSupportsStreaming(e.target.checked)}
          className="size-3.5 rounded border-border accent-primary"
        />
        <span className="text-[11px] text-muted-foreground">
          Supports streaming
        </span>
      </label>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={saved ? "outline" : "default"}
          className="h-8 text-xs"
          onClick={handleSave}
          disabled={!label.trim() || !baseUrl.trim() || !apiKey.trim()}
        >
          {saved && <Check size={12} className="mr-1" />}
          {saved ? "Saved" : "Save"}
        </Button>
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center justify-center size-8 shrink-0 rounded-md border border-destructive/25 bg-destructive/5 text-destructive/70 hover:text-destructive hover:bg-destructive/15 transition-colors"
          title="Remove provider"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function InferenceEndpointsSection({
  kind,
  sectionTitle,
  description,
  basePlaceholder,
}: {
  kind: InferenceProfileKind;
  sectionTitle: string;
  description: string;
  basePlaceholder: string;
}) {
  const [, bump] = useState(0);
  const profiles = getInferenceProfiles().filter((p) => p.kind === kind);

  const updateProfile = useCallback(
    (id: string, patch: Partial<InferenceProviderProfile>) => {
      const all = getInferenceProfiles();
      const next = all.map((p) => (p.id === id ? { ...p, ...patch } : p));
      void saveInferenceProfiles(next).then(() => bump((n) => n + 1));
    },
    [],
  );

  const removeProfile = useCallback((id: string) => {
    void saveInferenceProfiles(
      getInferenceProfiles().filter((p) => p.id !== id),
    ).then(() => bump((n) => n + 1));
  }, []);

  const addProfile = useCallback(() => {
    const next: InferenceProviderProfile = {
      id: crypto.randomUUID(),
      label: "",
      kind,
      baseUrl: "",
      apiKey: "",
    };
    void saveInferenceProfiles([...getInferenceProfiles(), next]).then(() =>
      bump((n) => n + 1),
    );
  }, [kind]);

  useEffect(() => {
    const sync = () => bump((n) => n + 1);
    window.addEventListener(KEYS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, sync);
  }, []);

  return (
    <div
      className="rounded-xl border border-border/60 bg-card p-4 space-y-3"
      data-settings-provider="openai_compatible"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[11px] font-bold text-muted-foreground">
          +
        </div>
        <div className="space-y-0.5">
          <h3 className="text-[13px] font-semibold">{sectionTitle}</h3>
          <p className="text-[11px] text-muted-foreground/60 leading-snug">
            {description}
          </p>
        </div>
      </div>

      {profiles.length > 0 && (
        <div className="space-y-2">
          {profiles.map((p) => (
            <InferenceProfileCard
              key={p.id}
              profile={p}
              onUpdate={(patch) => updateProfile(p.id, patch)}
              onRemove={() => removeProfile(p.id)}
              basePlaceholder={basePlaceholder}
            />
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full h-8 text-xs gap-1.5 border-dashed"
        onClick={addProfile}
      >
        <Plus size={12} />
        Add provider
      </Button>
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

  type SettingsEntry =
    | {
        kind: "builtin";
        provider: BuiltinSettingsProvider;
        placeholder: string;
        docsUrl: string;
        hasKey: boolean;
      }
    | { kind: "inference"; hasKey: boolean };

  const inferenceProfiles = getInferenceProfiles();
  const inferenceHasKey = inferenceProfiles.some(
    (p) => p.apiKey.trim() && p.baseUrl.trim() && p.label.trim(),
  );

  const entries: SettingsEntry[] = [
    {
      kind: "builtin",
      provider: "anthropic",
      placeholder: "sk-ant-api03-...",
      docsUrl: "https://console.anthropic.com/settings/keys",
      hasKey: !!getApiKey("anthropic"),
    },
    {
      kind: "builtin",
      provider: "openai",
      placeholder: "sk-proj-...",
      docsUrl: "https://platform.openai.com/api-keys",
      hasKey: !!getApiKey("openai"),
    },
    {
      kind: "builtin",
      provider: "xai",
      placeholder: "xai-...",
      docsUrl: "https://console.x.ai/",
      hasKey: !!getApiKey("xai"),
    },
    { kind: "inference", hasKey: inferenceHasKey },
  ];

  const sortedEntries = [...entries].sort((a, b) => {
    const aHas = a.hasKey ? 0 : 1;
    const bHas = b.hasKey ? 0 : 1;
    return aHas - bHas;
  });

  const configuredCount = entries.filter((e) => e.hasKey).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(720px,min(90dvh,85vh))] w-[min(100vw-1rem,32rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-lg safe-area-p"
      >
        <DialogHeader className="shrink-0 border-b border-border/50 px-5 pt-5 pb-4 text-left">
          <div className="space-y-1">
            <DialogTitle className="text-[17px] font-bold tracking-[-0.02em]">Settings</DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground/60">
              {configuredCount > 0
                ? `${configuredCount} provider${configuredCount === 1 ? "" : "s"} configured · keys stored locally`
                : "Add an API key to get started — keys never leave your browser."}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-2.5 px-4 py-4">
            {sortedEntries.map((entry) =>
              entry.kind === "builtin" ? (
                <ProviderRow
                  key={entry.provider}
                  provider={entry.provider}
                  placeholder={entry.placeholder}
                  docsUrl={entry.docsUrl}
                />
              ) : (
                <InferenceEndpointsSection
                  key="openai_compatible"
                  kind="openai_compatible"
                  sectionTitle="Custom providers"
                  description="OpenAI-compatible endpoints (Fireworks, OpenRouter, etc.)"
                  basePlaceholder="https://api.example.com/v1"
                />
              ),
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
