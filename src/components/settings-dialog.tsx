"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Check,
  ChevronDown,
  Cpu,
  Key,
  Plus,
  Trash2,
  CircleCheck,
  Circle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isLocalhostUrl } from "@/lib/ai-providers";
import { ExaKeyRow } from "@/components/exa-key-row";
import { MonoLabel } from "@/components/folio";
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  getInferenceProfiles,
  hasPlatformFallback,
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
  const [stored, setStored] = useState(() => getApiKey(provider) ?? "");
  const [value, setValue] = useState(() => getApiKey(provider) ?? "");
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const hasKey = !!stored;
  // No own key, but the platform has a shared fallback for this provider:
  // the provider already works; a personal key is optional.
  const usingFallback = !hasKey && hasPlatformFallback(provider);
  const dirty = value.trim() !== stored.trim();

  useEffect(() => {
    const sync = () => {
      const next = getApiKey(provider) ?? "";
      setStored(next);
      setValue(next);
    };
    sync();
    window.addEventListener(KEYS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, sync);
  }, [provider]);

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed || !dirty) return;
    void setApiKey(provider, trimmed).then(() => {
      setStored(trimmed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  const handleClear = () => {
    void clearApiKey(provider).then(() => {
      setStored("");
      setValue("");
      setVisible(false);
    });
  };

  return (
    <div
      data-settings-provider={provider}
      className="rounded-xl border border-border/60 bg-card transition-all duration-200"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold"
          style={{
            background: "var(--badge-accent-bg)",
            color: "var(--badge-accent-fg)",
          }}
        >
          {meta.label.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold tracking-[-0.005em] text-foreground">
            {meta.label}
          </p>
          <p
            className="truncate text-[12px] leading-snug"
            style={{
              fontFamily: "var(--font-reading)",
              color: hasKey
                ? "color-mix(in srgb, var(--success) 80%, transparent)"
                : usingFallback
                  ? "color-mix(in srgb, var(--primary) 80%, transparent)"
                  : "color-mix(in srgb, var(--muted-foreground) 80%, transparent)",
            }}
          >
            {hasKey
              ? "Configured"
              : usingFallback
                ? "Covered by Artifact during early access"
                : "Not set up yet"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasKey ? (
            <CircleCheck size={16} className="text-success" strokeWidth={2} />
          ) : usingFallback ? (
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
                  <ConfirmTrashButton
                    onConfirm={handleClear}
                    title="Remove key"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmTrashButton({
  onConfirm,
  title,
  size: btnSize = 9,
}: {
  onConfirm: () => void;
  title: string;
  /** Tailwind size unit — 9 → size-9 (36px), 8 → size-8 (32px). */
  size?: 8 | 9;
}) {
  const [confirming, setConfirming] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleClick = () => {
    if (confirming) {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      setConfirming(false);
      onConfirm();
      return;
    }
    setConfirming(true);
    timeoutRef.current = window.setTimeout(() => {
      setConfirming(false);
    }, 2500);
  };

  const sizeClass = btnSize === 9 ? "size-9" : "size-8";
  const iconSize = btnSize === 9 ? 14 : 13;

  return (
    <button
      type="button"
      onClick={handleClick}
      onBlur={() => {
        if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
        setConfirming(false);
      }}
      className={cn(
        "flex items-center justify-center shrink-0 rounded-md transition-colors",
        sizeClass,
        confirming
          ? "border border-destructive bg-destructive text-destructive-foreground"
          : "border border-destructive/25 bg-destructive/5 text-destructive/70 hover:text-destructive hover:bg-destructive/15",
      )}
      title={confirming ? "Click again to confirm" : title}
      aria-label={confirming ? "Click again to confirm" : title}
    >
      {confirming ? <Check size={iconSize} /> : <Trash2 size={iconSize} />}
    </button>
  );
}

function InferenceProfileCard({
  profile,
  onUpdate,
  onRemove,
  basePlaceholder,
  isDraft,
}: {
  profile: InferenceProviderProfile;
  onUpdate: (patch: Partial<InferenceProviderProfile>) => void;
  onRemove: () => void;
  basePlaceholder: string;
  isDraft: boolean;
}) {
  const [label, setLabel] = useState(profile.label);
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl);
  const [apiKey, setApiKey] = useState(profile.apiKey);
  const [supportsStreaming, setSupportsStreaming] = useState(
    profile.supportsStreaming !== false,
  );
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  // Drafts open expanded so the user can fill them in immediately;
  // already-saved profiles default collapsed so a list of three of
  // them doesn't become a wall of inputs.
  const [expanded, setExpanded] = useState(isDraft);

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

  const dirty =
    label !== profile.label ||
    baseUrl !== profile.baseUrl ||
    apiKey !== profile.apiKey ||
    supportsStreaming !== (profile.supportsStreaming !== false);

  // A persisted profile is "configured" when it has the minimum
  // credentials to be usable (label + baseUrl). Drafts never count
  // until they're committed, so they always read as not configured.
  const configured =
    !isDraft && !!profile.label.trim() && !!profile.baseUrl.trim();

  const handleSave = () => {
    if (!isValidUrl(baseUrl.trim())) {
      setUrlError("Enter a valid URL (e.g. https://api.example.com/v1)");
      return;
    }
    setUrlError("");
    onUpdate({
      label: label.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: isLocalhostUrl(baseUrl) ? "" : apiKey.trim(),
      supportsStreaming,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Header strings reflect live edits so collapsing mid-typing doesn't
  // hide the user's in-progress changes — but the configured pill stays
  // tied to persisted state so it accurately reports whether the saved
  // profile is usable.
  const headerTitle = label.trim() || "Custom provider";
  const headerSubtitle =
    baseUrl.trim() ||
    (isDraft ? "Not configured yet" : "Set a base URL to enable");

  return (
    <div
      data-settings-profile={profile.id}
      className="rounded-lg border border-border/50 bg-background/50 transition-all duration-200"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="truncate text-[12.5px] font-semibold tracking-[-0.005em] text-foreground">
            {headerTitle}
          </p>
          <p
            className="truncate text-[11px] leading-snug"
            style={{
              fontFamily: "var(--font-reading)",
              color: configured
                ? "color-mix(in srgb, var(--success) 75%, transparent)"
                : "color-mix(in srgb, var(--muted-foreground) 75%, transparent)",
            }}
          >
            {headerSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {configured ? (
            <CircleCheck
              size={14}
              className="text-success"
              strokeWidth={2}
              aria-label="Configured"
            />
          ) : (
            <Circle
              size={14}
              className="text-muted-foreground/30"
              strokeWidth={1.5}
              aria-label="Not configured"
            />
          )}
          <ChevronDown
            size={12}
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
          <div className="px-3 pb-3 pt-0.5 space-y-2.5">
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
              {urlError && (
                <p className="text-[10px] text-destructive">{urlError}</p>
              )}
            </div>

            {!isLocalhostUrl(baseUrl) && (
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={visible ? "Hide key" : "Show key"}
                >
                  {visible ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            )}

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
                className={
                  saved
                    ? "text-success border-success/35 gap-1 h-8 text-xs"
                    : "h-8 text-xs gap-1"
                }
                onClick={handleSave}
                disabled={
                  !label.trim() || !baseUrl.trim() || (!dirty && !isDraft)
                }
              >
                {saved && <Check size={12} />}
                {saved ? "Saved" : isDraft ? "Save" : "Update"}
              </Button>
              <ConfirmTrashButton
                onConfirm={onRemove}
                title={isDraft ? "Discard" : "Remove provider"}
                size={8}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface LocalLlmPreset {
  name: string;
  baseUrl: string;
}

const LOCAL_LLM_PRESETS: LocalLlmPreset[] = [
  { name: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { name: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  { name: "llama.cpp", baseUrl: "http://localhost:8080/v1" },
  { name: "vLLM", baseUrl: "http://localhost:8000/v1" },
];

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
  const persisted = getInferenceProfiles().filter((p) => p.kind === kind);

  // Drafts live only in component state — they don't hit storage until
  // the user clicks Save with valid input. This prevents abandoned
  // "Add provider" clicks from leaving empty rows behind.
  const [drafts, setDrafts] = useState<InferenceProviderProfile[]>([]);

  const persistedIds = useMemo(
    () => new Set(persisted.map((p) => p.id)),
    [persisted],
  );
  const visibleDrafts = drafts.filter((d) => !persistedIds.has(d.id));

  const handleUpdate = useCallback(
    (id: string, patch: Partial<InferenceProviderProfile>) => {
      const isDraft = drafts.some((d) => d.id === id);
      if (isDraft) {
        const draft = drafts.find((d) => d.id === id)!;
        const promoted = { ...draft, ...patch };
        void saveInferenceProfiles([...getInferenceProfiles(), promoted]).then(
          () => {
            setDrafts((ds) => ds.filter((d) => d.id !== id));
            bump((n) => n + 1);
          },
        );
        return;
      }
      const all = getInferenceProfiles();
      const next = all.map((p) => (p.id === id ? { ...p, ...patch } : p));
      void saveInferenceProfiles(next).then(() => bump((n) => n + 1));
    },
    [drafts],
  );

  const handleRemove = useCallback(
    (id: string) => {
      if (drafts.some((d) => d.id === id)) {
        setDrafts((ds) => ds.filter((d) => d.id !== id));
        return;
      }
      void saveInferenceProfiles(
        getInferenceProfiles().filter((p) => p.id !== id),
      ).then(() => bump((n) => n + 1));
    },
    [drafts],
  );

  const addDraft = useCallback(() => {
    setDrafts((ds) => [
      ...ds,
      {
        id: crypto.randomUUID(),
        label: "",
        kind,
        baseUrl: "",
        apiKey: "",
      },
    ]);
  }, [kind]);

  const addLocalProfile = useCallback(
    (preset: LocalLlmPreset) => {
      // Local presets ship with valid label + baseUrl, so we persist
      // them directly — no draft step needed.
      const next: InferenceProviderProfile = {
        id: crypto.randomUUID(),
        label: `${preset.name} (local)`,
        kind,
        baseUrl: preset.baseUrl,
        apiKey: "",
        supportsStreaming: true,
      };
      void saveInferenceProfiles([...getInferenceProfiles(), next]).then(() =>
        bump((n) => n + 1),
      );
    },
    [kind],
  );

  useEffect(() => {
    const sync = () => bump((n) => n + 1);
    window.addEventListener(KEYS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, sync);
  }, []);

  const all = [...persisted, ...visibleDrafts];

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
          <h3 className="text-[13px] font-semibold tracking-[-0.005em]">
            {sectionTitle}
          </h3>
          <p
            className="text-[11px] leading-snug"
            style={{
              fontFamily: "var(--font-reading)",
              color:
                "color-mix(in srgb, var(--muted-foreground) 70%, transparent)",
            }}
          >
            {description}
          </p>
        </div>
      </div>

      {all.length > 0 && (
        <div className="space-y-2">
          {all.map((p) => (
            <InferenceProfileCard
              key={p.id}
              profile={p}
              onUpdate={(patch) => handleUpdate(p.id, patch)}
              onRemove={() => handleRemove(p.id)}
              basePlaceholder={basePlaceholder}
              isDraft={!persistedIds.has(p.id)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs sm:flex-1"
          onClick={addDraft}
        >
          <Plus size={12} />
          Add provider
        </Button>
        {/* Local LLM presets are desktop-only — mobile devices can't host an inference server. */}
        <DropdownMenu>
          <DropdownMenuTrigger className="hidden h-8 items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 bg-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted/50 hover:text-foreground sm:inline-flex">
            <Cpu size={12} />
            Add local LLM
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {LOCAL_LLM_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.name}
                className="cursor-pointer text-xs"
                onClick={() => addLocalProfile(preset)}
              >
                {preset.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {persisted.some((p) => isLocalhostUrl(p.baseUrl)) && (
        <LocalLlmDeployedSiteHelp />
      )}
    </div>
  );
}

function LocalLlmDeployedSiteHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="font-medium">
          Using a local LLM on a deployed site?
        </span>
        <ChevronDown
          size={12}
          className={cn("shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-muted-foreground/90">
          <p>
            On <code className="font-mono">localhost</code> dev, this just
            works. On a deployed (https) site, the server can&apos;t reach your
            machine, so you have two options:
          </p>
          <div className="space-y-1">
            <p className="font-medium text-foreground/80">
              1. Allow direct browser access (model list only)
            </p>
            <p>
              Start Ollama with this origin allowed so the model dropdown can
              populate from your browser:
            </p>
            <pre className="overflow-x-auto rounded bg-background/60 px-2 py-1 font-mono text-[10px]">
              OLLAMA_ORIGINS=
              {typeof window !== "undefined"
                ? window.location.origin
                : "https://your-site"}{" "}
              ollama serve
            </pre>
            <p className="text-muted-foreground/70">
              Note: chat itself still won&apos;t work this way. The chat
              endpoint runs server-side.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground/80">
              2. Expose Ollama via a tunnel (full chat support)
            </p>
            <p>
              Run a tunnel and paste the public URL (with{" "}
              <code className="font-mono">/v1</code> appended) as the base URL
              above. Leave the API key blank.
            </p>
            <pre className="overflow-x-auto rounded bg-background/60 px-2 py-1 font-mono text-[10px]">
              cloudflared tunnel --url http://localhost:11434 \{"\n"}
              {"  "}--http-host-header localhost:11434
            </pre>
            <p className="text-muted-foreground/70">
              The <code className="font-mono">--http-host-header</code> flag is
              required: Ollama rejects requests whose Host header isn&apos;t
              <code className="font-mono"> localhost</code> (anti-DNS-rebinding
              check). Without it you&apos;ll see a 403.
            </p>
            <p>
              ngrok alternative:{" "}
              <code className="font-mono">
                ngrok http 11434 --host-header=localhost:11434
              </code>
              .
            </p>
            <p className="text-muted-foreground/70">
              Cloudflare quick tunnels rotate the URL on every restart. Re-run
              the command and update the Base URL when that happens.
            </p>
          </div>
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

  type BuiltinEntry = {
    kind: "builtin";
    provider: BuiltinSettingsProvider;
    placeholder: string;
    docsUrl: string;
  };
  type InferenceEntry = { kind: "inference" };
  type SettingsEntry = BuiltinEntry | InferenceEntry;

  const baseEntries: SettingsEntry[] = useMemo(
    () => [
      {
        kind: "builtin",
        provider: "anthropic",
        placeholder: "sk-ant-api03-...",
        docsUrl: "https://console.anthropic.com/settings/keys",
      },
      {
        kind: "builtin",
        provider: "openai",
        placeholder: "sk-proj-...",
        docsUrl: "https://platform.openai.com/api-keys",
      },
      {
        kind: "builtin",
        provider: "xai",
        placeholder: "xai-...",
        docsUrl: "https://console.x.ai/",
      },
      { kind: "inference" },
    ],
    [],
  );

  // Sort order is snapshotted when the dialog opens so saving a new key
  // mid-session doesn't reflow rows under the user's cursor.
  const computeOrderedEntries = useCallback((): SettingsEntry[] => {
    const hasKeyFor = (entry: SettingsEntry) => {
      if (entry.kind === "builtin") return !!getApiKey(entry.provider);
      return getInferenceProfiles().some(
        (p) => p.apiKey.trim() && p.baseUrl.trim() && p.label.trim(),
      );
    };
    return [...baseEntries].sort((a, b) => {
      const aHas = hasKeyFor(a) ? 0 : 1;
      const bHas = hasKeyFor(b) ? 0 : 1;
      return aHas - bHas;
    });
  }, [baseEntries]);

  // Re-snapshot whenever the dialog opens (or closes — invisible recomputes
  // are harmless since the body isn't rendered). Within a single open
  // session, order is stable so saving a key doesn't reflow rows.
  // `open` is in deps intentionally — it's the trigger, not data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const orderedEntries = useMemo(() => computeOrderedEntries(), [open]);

  // Live count for the header description — recomputes on key changes.
  const [configuredCount, setConfiguredCount] = useState(0);
  useEffect(() => {
    const recount = () => {
      const builtinCount = (
        ["anthropic", "openai", "xai"] as BuiltinSettingsProvider[]
      ).filter((p) => !!getApiKey(p)).length;
      const inferenceCount = getInferenceProfiles().some(
        (p) => p.apiKey.trim() && p.baseUrl.trim() && p.label.trim(),
      )
        ? 1
        : 0;
      setConfiguredCount(builtinCount + inferenceCount);
    };
    recount();
    window.addEventListener(KEYS_UPDATED_EVENT, recount);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, recount);
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
            {configuredCount > 0
              ? `${configuredCount} configured.`
              : (
                    ["anthropic", "openai", "xai"] as BuiltinSettingsProvider[]
                  ).some((p) => hasPlatformFallback(p))
                ? "Artifact is covering AI costs while in early access."
                : "Add a key for any provider to start chatting."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-2.5 px-4 py-4">
            <h3 className="px-1 pb-0.5">
              <MonoLabel>Model providers</MonoLabel>
            </h3>
            {orderedEntries.map((entry) =>
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
                  description="OpenAI-compatible APIs, including OpenRouter, Fireworks, vLLM, etc."
                  basePlaceholder="https://api.example.com/v1"
                />
              ),
            )}
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
