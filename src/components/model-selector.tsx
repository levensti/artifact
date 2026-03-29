"use client";

import {
  Fragment,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, KeyRound, Loader2, RefreshCw } from "lucide-react";
import {
  PROVIDER_ORDER,
  PROVIDER_META,
  type Model,
  type Provider,
} from "@/lib/models";
import { cn } from "@/lib/utils";
import { getApiKey, hasAnySavedApiKey, KEYS_UPDATED_EVENT } from "@/lib/keys";
import { useSettingsOpener } from "@/components/settings-opener-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ProviderModelsState =
  | { status: "no-key" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; models: Model[] };

interface ModelSelectorProps {
  selected: Model | null;
  onSelect: (model: Model | null) => void;
}

export default function ModelSelector({ selected, onSelect }: ModelSelectorProps) {
  const { openSettings } = useSettingsOpener();
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const [keysVersion, setKeysVersion] = useState(0);
  const [refetchTick, setRefetchTick] = useState(0);
  const [byProvider, setByProvider] = useState<
    Partial<Record<Provider, ProviderModelsState>>
  >({});

  useEffect(() => {
    const onKeys = () => setKeysVersion((v) => v + 1);
    window.addEventListener(KEYS_UPDATED_EVENT, onKeys);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, onKeys);
  }, []);

  useEffect(() => {
    if (selected && !getApiKey(selected.provider)) {
      onSelectRef.current(null);
    }
  }, [selected, keysVersion]);

  useEffect(() => {
    let cancelled = false;

    const keyed = PROVIDER_ORDER.filter((p) => !!getApiKey(p));

    const next: Partial<Record<Provider, ProviderModelsState>> = {};
    for (const p of PROVIDER_ORDER) {
      next[p] = getApiKey(p) ? { status: "loading" } : { status: "no-key" };
    }
    startTransition(() => {
      setByProvider(next);
    });

    if (keyed.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const results = await Promise.all(
        keyed.map(async (provider) => {
          const apiKey = getApiKey(provider)!;
          try {
            const response = await fetch("/api/models", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider, apiKey }),
            });
            if (!response.ok) {
              return { provider, result: { status: "error" } as const };
            }
            const data = (await response.json()) as {
              models?: Array<{ id: string; label: string }>;
            };
            const models = (data.models ?? []).map(
              (m) =>
                ({
                  id: `${provider}-${m.id}`,
                  label: m.label,
                  modelId: m.id,
                  provider,
                }) satisfies Model,
            );
            return { provider, result: { status: "ok", models } as const };
          } catch {
            return { provider, result: { status: "error" } as const };
          }
        }),
      );

      if (cancelled) return;

      setByProvider((prev) => {
        const merged: Partial<Record<Provider, ProviderModelsState>> = {
          ...prev,
        };
        for (const { provider, result } of results) {
          merged[provider] = result;
        }
        return merged;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [keysVersion, refetchTick]);

  const anyKey = hasAnySavedApiKey();

  /** True while a keyed provider has not yet resolved (avoids flash before fetch effect runs). */
  const loadingKeyed = PROVIDER_ORDER.some((p) => {
    if (!getApiKey(p)) return false;
    const s = byProvider[p];
    return s === undefined || s.status === "loading";
  });

  const totalSelectable = useMemo(() => {
    let n = 0;
    for (const p of PROVIDER_ORDER) {
      const s = byProvider[p];
      if (s?.status === "ok") n += s.models.length;
    }
    return n;
  }, [byProvider]);

  const triggerLabel =
    selected && getApiKey(selected.provider)
      ? selected.label
      : !anyKey
        ? "Add API key first"
        : loadingKeyed && totalSelectable === 0
          ? "Loading models…"
          : "Select model";

  const showTriggerSpinner =
    !selected && anyKey && loadingKeyed && totalSelectable === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center h-7 gap-1 max-w-[min(200px,42vw)] px-2 text-xs text-muted-foreground font-normal rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
        aria-label={selected ? `Model: ${selected.label}` : triggerLabel}
      >
        <span className="truncate">{triggerLabel}</span>
        {showTriggerSpinner ? (
          <Loader2 size={10} className="animate-spin shrink-0" />
        ) : (
          <ChevronDown size={10} className="shrink-0" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(18rem,calc(100vw-1.5rem))]">
        {!anyKey ? (
          <div className="px-2 py-3 space-y-2">
            <p className="text-[11px] text-muted-foreground leading-relaxed px-0.5">
              Add a key for any provider to load models. Keys stay on this
              device.
            </p>
            <DropdownMenuItem
              className="text-xs gap-2 cursor-pointer"
              onClick={() => openSettings()}
            >
              <KeyRound className="size-3.5 opacity-80" />
              Manage API keys
            </DropdownMenuItem>
          </div>
        ) : (
          PROVIDER_ORDER.map((provider, groupIndex) => {
            const meta = PROVIDER_META[provider];
            const hasKey = !!getApiKey(provider);
            const raw = byProvider[provider];
            const state: ProviderModelsState = !hasKey
              ? { status: "no-key" }
              : raw ?? { status: "loading" };

            return (
              <Fragment key={provider}>
                {groupIndex > 0 && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-[11px] font-medium text-foreground">
                    {meta.label}
                  </DropdownMenuLabel>

                  {state.status === "no-key" && (
                    <>
                      <p className="px-1.5 pb-1 text-[10px] text-muted-foreground leading-snug">
                        Add your {meta.label} key to load models from this
                        provider.
                      </p>
                      <DropdownMenuItem
                        className="text-xs gap-2 cursor-pointer text-primary focus:text-primary"
                        onClick={() => openSettings({ provider })}
                      >
                        <KeyRound className="size-3.5 opacity-80" />
                        Add {meta.label} API key…
                      </DropdownMenuItem>
                    </>
                  )}

                  {state.status === "loading" && (
                    <DropdownMenuItem disabled className="text-xs gap-2 opacity-100">
                      <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      <span className="text-muted-foreground">Loading models…</span>
                    </DropdownMenuItem>
                  )}

                  {state.status === "error" && (
                    <>
                      <p className="px-1.5 pb-1 text-[10px] text-muted-foreground leading-snug">
                        Could not load models. Check the key or try again.
                      </p>
                      <DropdownMenuItem
                        className="text-xs gap-2 cursor-pointer"
                        onClick={() => setRefetchTick((t) => t + 1)}
                      >
                        <RefreshCw className="size-3.5 opacity-80" />
                        Retry
                      </DropdownMenuItem>
                    </>
                  )}

                  {state.status === "ok" && state.models.length === 0 && (
                    <>
                      <p className="px-1.5 pb-1 text-[10px] text-muted-foreground leading-snug">
                        No models returned for this key.
                      </p>
                      <DropdownMenuItem
                        className="text-xs gap-2 cursor-pointer"
                        onClick={() => setRefetchTick((t) => t + 1)}
                      >
                        <RefreshCw className="size-3.5 opacity-80" />
                        Refresh list
                      </DropdownMenuItem>
                    </>
                  )}

                  {state.status === "ok" &&
                    state.models.map((model) => (
                      <DropdownMenuItem
                        key={model.id}
                        className="flex items-center justify-between gap-2 cursor-pointer"
                        onClick={() => onSelect(model)}
                      >
                        <span
                          className={cn(
                            "text-xs truncate",
                            selected?.id === model.id && "text-primary font-medium",
                          )}
                        >
                          {model.label}
                        </span>
                        {selected?.id === model.id && (
                          <Check size={12} className="text-primary shrink-0" />
                        )}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
              </Fragment>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
