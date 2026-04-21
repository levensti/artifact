"use client";

import {
  Fragment,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, KeyRound, Loader2, RefreshCw, Settings } from "lucide-react";
import {
  PROVIDER_ORDER,
  PROVIDER_META,
  type InferenceProviderProfile,
  type Model,
  type Provider,
} from "@/lib/models";
import { cn } from "@/lib/utils";
import {
  getApiKey,
  getInferenceProfiles,
  hasAnySavedApiKey,
  isBuiltinProviderReady,
  isModelReady,
  KEYS_UPDATED_EVENT,
} from "@/lib/keys";
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

type FetchJob =
  | { kind: "builtin"; provider: Provider; key: string }
  | {
      kind: "profile";
      profile: InferenceProviderProfile;
      key: string;
    };

export default function ModelSelector({
  selected,
  onSelect,
}: ModelSelectorProps) {
  const { openSettings } = useSettingsOpener();
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const [keysVersion, setKeysVersion] = useState(0);
  const [refetchTick, setRefetchTick] = useState(0);
  const [modelsByFetchKey, setModelsByFetchKey] = useState<
    Partial<Record<string, ProviderModelsState>>
  >({});

  useEffect(() => {
    const onKeys = () => setKeysVersion((v) => v + 1);
    window.addEventListener(KEYS_UPDATED_EVENT, onKeys);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, onKeys);
  }, []);

  useEffect(() => {
    if (selected && !isModelReady(selected)) {
      onSelectRef.current(null);
    }
  }, [selected, keysVersion]);

  useEffect(() => {
    let cancelled = false;

    const jobs: FetchJob[] = [];
    for (const p of PROVIDER_ORDER) {
      if (isBuiltinProviderReady(p)) {
        jobs.push({ kind: "builtin", provider: p, key: p });
      }
    }
    for (const prof of getInferenceProfiles()) {
      if (prof.apiKey.trim() && prof.baseUrl.trim() && prof.label.trim()) {
        jobs.push({ kind: "profile", profile: prof, key: prof.id });
      }
    }

    const next: Partial<Record<string, ProviderModelsState>> = {};
    for (const j of jobs) {
      next[j.key] = { status: "loading" };
    }
    startTransition(() => {
      setModelsByFetchKey((prev) => ({ ...prev, ...next }));
    });

    if (jobs.length === 0) {
      startTransition(() => setModelsByFetchKey({}));
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const results = await Promise.all(
        jobs.map(async (job) => {
          try {
            const body =
              job.kind === "builtin"
                ? {
                    provider: job.provider,
                    apiKey: getApiKey(job.provider) ?? "",
                  }
                : {
                    provider: job.profile.kind,
                    apiKey: job.profile.apiKey,
                    apiBaseUrl: job.profile.baseUrl,
                  };
            const response = await fetch("/api/models", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            if (!response.ok) {
              return { key: job.key, result: { status: "error" } as const };
            }
            const data = (await response.json()) as {
              models?: Array<{ id: string; label: string }>;
            };
            const models = (data.models ?? []).map((m) => {
              if (job.kind === "builtin") {
                return {
                  id: `${job.provider}-${m.id}`,
                  label: m.label,
                  modelId: m.id,
                  provider: job.provider,
                } satisfies Model;
              }
              return {
                id: `${job.profile.id}-${m.id}`,
                label: `${job.profile.label} · ${m.label}`,
                modelId: m.id,
                provider: job.profile.kind,
                profileId: job.profile.id,
              } satisfies Model;
            });
            return {
              key: job.key,
              result: { status: "ok" as const, models },
            };
          } catch {
            return { key: job.key, result: { status: "error" } as const };
          }
        }),
      );

      if (cancelled) return;

      setModelsByFetchKey((prev) => {
        const merged: Partial<Record<string, ProviderModelsState>> = {
          ...prev,
        };
        for (const { key, result } of results) {
          merged[key] = result;
        }
        return merged;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [keysVersion, refetchTick]);

  const anyKey = hasAnySavedApiKey();

  const loadingKeyed = useMemo(() => {
    const jobs: string[] = [
      ...PROVIDER_ORDER.filter((p) => isBuiltinProviderReady(p)),
      ...getInferenceProfiles()
        .filter((p) => p.apiKey.trim() && p.baseUrl.trim() && p.label.trim())
        .map((p) => p.id),
    ];
    return jobs.some((k) => {
      const s = modelsByFetchKey[k];
      return s === undefined || s.status === "loading";
    });
  }, [modelsByFetchKey]);

  const totalSelectable = useMemo(() => {
    let n = 0;
    for (const s of Object.values(modelsByFetchKey)) {
      if (s?.status === "ok") n += s.models.length;
    }
    return n;
  }, [modelsByFetchKey]);

  const triggerLabel =
    selected && isModelReady(selected)
      ? selected.label
      : !anyKey
        ? "Add API key"
        : loadingKeyed && totalSelectable === 0
          ? "Loading…"
          : "Select model";

  const showTriggerSpinner =
    !selected && anyKey && loadingKeyed && totalSelectable === 0;

  const hasModelSelected = !!(selected && isModelReady(selected));

  const inferenceProfiles = getInferenceProfiles();

  const readyBuiltinProviders = useMemo(
    () => (PROVIDER_ORDER as (keyof typeof PROVIDER_META)[]).filter((p) => isBuiltinProviderReady(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keysVersion],
  );

  const readyInferenceProfiles = useMemo(
    () => inferenceProfiles.filter((p) => p.apiKey.trim() && p.baseUrl.trim() && p.label.trim()),
    [inferenceProfiles],
  );

  function renderBuiltinGroup(
    provider: keyof typeof PROVIDER_META,
    groupIndex: number,
  ) {
    const meta = PROVIDER_META[provider];
    const raw = modelsByFetchKey[provider];
    const state: ProviderModelsState = raw ?? { status: "loading" };

    return (
      <Fragment key={provider}>
        {groupIndex > 0 && <DropdownMenuSeparator />}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            {meta.label}
          </DropdownMenuLabel>

          {state.status === "loading" && (
            <DropdownMenuItem disabled className="text-xs gap-2 opacity-100">
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading…</span>
            </DropdownMenuItem>
          )}

          {state.status === "error" && (
            <DropdownMenuItem
              className="text-xs gap-2 cursor-pointer"
              onClick={() => setRefetchTick((t) => t + 1)}
            >
              <RefreshCw className="size-3.5 opacity-80" />
              Retry
            </DropdownMenuItem>
          )}

          {state.status === "ok" && state.models.length === 0 && (
            <DropdownMenuItem
              className="text-xs gap-2 cursor-pointer"
              onClick={() => setRefetchTick((t) => t + 1)}
            >
              <RefreshCw className="size-3.5 opacity-80" />
              No models found — retry
            </DropdownMenuItem>
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
  }

  function renderProfileGroup(
    profiles: InferenceProviderProfile[],
  ) {
    if (profiles.length === 0) return null;

    return (
      <Fragment key="inference">
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {profiles.map((prof) => {
            const raw = modelsByFetchKey[prof.id];
            const state: ProviderModelsState = raw ?? { status: "loading" };

            return (
              <Fragment key={prof.id}>
                <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  {prof.label}
                </DropdownMenuLabel>

                {state.status === "loading" && (
                  <DropdownMenuItem
                    disabled
                    className="text-xs gap-2 opacity-100"
                  >
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground">Loading…</span>
                  </DropdownMenuItem>
                )}

                {state.status === "error" && (
                  <DropdownMenuItem
                    className="text-xs gap-2 cursor-pointer"
                    onClick={() => setRefetchTick((t) => t + 1)}
                  >
                    <RefreshCw className="size-3.5 opacity-80" />
                    Retry
                  </DropdownMenuItem>
                )}

                {state.status === "ok" && state.models.length === 0 && (
                  <p className="px-1.5 pb-1 text-[10px] text-muted-foreground">
                    No models listed.
                  </p>
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
                          selected?.id === model.id &&
                            "text-primary font-medium",
                        )}
                      >
                        {model.label.includes("·")
                          ? model.label.split("·").pop()?.trim()
                          : model.label}
                      </span>
                      {selected?.id === model.id && (
                        <Check size={12} className="text-primary shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
              </Fragment>
            );
          })}
        </DropdownMenuGroup>
      </Fragment>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex max-w-[min(200px,42vw)] items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs transition-all duration-150 hover:border-border hover:bg-muted/50",
          hasModelSelected
            ? "font-medium text-foreground"
            : "text-muted-foreground",
        )}
        aria-label={selected ? `Model: ${selected.label}` : triggerLabel}
      >
        {showTriggerSpinner ? (
          <Loader2 className="size-3 animate-spin shrink-0" />
        ) : null}
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown
          className="size-3 shrink-0 text-muted-foreground/50"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(16rem,calc(100vw-1.5rem))]"
      >
        {!anyKey ? (
          <div className="px-2 py-3 space-y-2">
            <p className="text-[11px] text-muted-foreground leading-relaxed px-0.5">
              Add an API key in Settings to load available models.
            </p>
            <DropdownMenuItem
              className="text-xs gap-2 cursor-pointer"
              onClick={() => openSettings()}
            >
              <KeyRound className="size-3.5 opacity-80" />
              Open Settings
            </DropdownMenuItem>
          </div>
        ) : (
          <>
            {readyBuiltinProviders.map((provider, idx) =>
              renderBuiltinGroup(provider, idx),
            )}
            {renderProfileGroup(readyInferenceProfiles)}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[11px] gap-2 cursor-pointer text-muted-foreground"
              onClick={() => openSettings()}
            >
              <Settings className="size-3 opacity-60" />
              Add more providers…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
