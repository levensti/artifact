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
import {
  hasInferenceCredentials,
  isLocalhostUrl,
  openAiCompatibleModelsListUrl,
  type OpenAiCompatibleProvider,
} from "@/lib/ai-providers";
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
import { MonoLabel } from "@/components/folio";
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
  | { status: "error"; message?: string }
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

type ModelsListResponse = { models?: Array<{ id: string; label: string }> };
type FetchModelsResult =
  | { ok: true; data: ModelsListResponse }
  | { ok: false; message?: string };

function localhostUnreachableMessage(): string {
  // Both "server not running" and "CORS rejection" surface as a TypeError on
  // the client — we can't distinguish them, so cover both possibilities.
  const origin =
    typeof window !== "undefined" ? window.location.origin : "this site";
  return `Can't reach local server. Make sure it's running and that it allows requests from ${origin} (e.g. OLLAMA_ORIGINS=${origin}).`;
}

async function fetchProxiedModelsList(
  job: FetchJob,
): Promise<FetchModelsResult> {
  const body =
    job.kind === "builtin"
      ? { provider: job.provider, apiKey: getApiKey(job.provider) ?? "" }
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
    let message: string | undefined;
    try {
      const errBody = (await response.json()) as { error?: string };
      if (typeof errBody?.error === "string") message = errBody.error;
    } catch {
      // ignore
    }
    return { ok: false, message };
  }
  return { ok: true, data: (await response.json()) as ModelsListResponse };
}

async function fetchLocalhostModelsList(
  profile: InferenceProviderProfile,
): Promise<FetchModelsResult> {
  const url = openAiCompatibleModelsListUrl(
    profile.kind as OpenAiCompatibleProvider,
    profile.baseUrl,
  );
  const headers: Record<string, string> = {};
  if (profile.apiKey.trim()) {
    headers.Authorization = `Bearer ${profile.apiKey}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    return { ok: false, message: `${response.status} ${response.statusText}` };
  }
  const data = (await response.json()) as {
    data?: unknown;
    models?: unknown;
  };
  const rawList = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : [];
  const models = rawList
    .map((m: { id?: string }) => m.id)
    .filter((id: unknown): id is string => typeof id === "string")
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, label: id }));
  return { ok: true, data: { models } };
}

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
      if (prof.label.trim() && hasInferenceCredentials(prof)) {
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
            // For localhost inference profiles, the Next.js server can't reach
            // the user's machine — fetch the models list directly from the
            // browser. Requires the local server to allow this origin (e.g.
            // OLLAMA_ORIGINS for Ollama).
            const useDirectLocalhost =
              job.kind === "profile" && isLocalhostUrl(job.profile.baseUrl);
            const result = useDirectLocalhost
              ? await fetchLocalhostModelsList(
                  (job as Extract<FetchJob, { kind: "profile" }>).profile,
                )
              : await fetchProxiedModelsList(job);
            if (!result.ok) {
              return {
                key: job.key,
                result: {
                  status: "error" as const,
                  message:
                    result.message ??
                    (useDirectLocalhost
                      ? localhostUnreachableMessage()
                      : undefined),
                },
              };
            }
            const data = result.data;
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
            const useDirectLocalhost =
              job.kind === "profile" && isLocalhostUrl(job.profile.baseUrl);
            return {
              key: job.key,
              result: {
                status: "error" as const,
                message: useDirectLocalhost
                  ? localhostUnreachableMessage()
                  : undefined,
              },
            };
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
        .filter((p) => p.label.trim() && hasInferenceCredentials(p))
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
    () => inferenceProfiles.filter((p) => p.label.trim() && hasInferenceCredentials(p)),
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
          <DropdownMenuLabel className="px-2 pt-1.5 pb-1">
            <MonoLabel>{meta.label}</MonoLabel>
          </DropdownMenuLabel>

          {state.status === "loading" && (
            <DropdownMenuItem disabled className="text-xs gap-2 opacity-100">
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading…</span>
            </DropdownMenuItem>
          )}

          {state.status === "error" && (
            <>
              {state.message && (
                <p className="px-2 pt-1 pb-0.5 text-[10px] leading-snug text-muted-foreground">
                  {state.message}
                </p>
              )}
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
            <DropdownMenuItem
              className="text-xs gap-2 cursor-pointer"
              onClick={() => setRefetchTick((t) => t + 1)}
            >
              <RefreshCw className="size-3.5 opacity-80" />
              No models found — retry
            </DropdownMenuItem>
          )}

          {state.status === "ok" &&
            state.models.map((model) => {
              const isSelected = selected?.id === model.id;
              return (
                <DropdownMenuItem
                  key={model.id}
                  className={cn(
                    "flex items-center justify-between gap-2 cursor-pointer",
                    isSelected && "bg-[var(--badge-accent-bg)]",
                  )}
                  onClick={() => onSelect(model)}
                >
                  <span
                    className={cn(
                      "truncate text-[12.5px]",
                      isSelected
                        ? "font-medium text-foreground"
                        : "text-foreground/85",
                    )}
                  >
                    {model.label}
                  </span>
                  {isSelected && (
                    <Check size={12} className="shrink-0 text-primary" />
                  )}
                </DropdownMenuItem>
              );
            })}
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
                <DropdownMenuLabel className="px-2 pt-1.5 pb-1">
                  <MonoLabel>{prof.label}</MonoLabel>
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
                  <>
                    {state.message && (
                      <p className="px-2 pt-1 pb-0.5 text-[10px] leading-snug text-muted-foreground">
                        {state.message}
                      </p>
                    )}
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
                  <p className="px-1.5 pb-1 text-[10px] text-muted-foreground">
                    No models listed.
                  </p>
                )}

                {state.status === "ok" &&
                  state.models.map((model) => {
                    const isSelected = selected?.id === model.id;
                    const display = model.label.includes("·")
                      ? model.label.split("·").pop()?.trim()
                      : model.label;
                    return (
                      <DropdownMenuItem
                        key={model.id}
                        className={cn(
                          "flex items-center justify-between gap-2 cursor-pointer",
                          isSelected && "bg-[var(--badge-accent-bg)]",
                        )}
                        onClick={() => onSelect(model)}
                      >
                        <span
                          className={cn(
                            "truncate text-[12.5px]",
                            isSelected
                              ? "font-medium text-foreground"
                              : "text-foreground/85",
                          )}
                        >
                          {display}
                        </span>
                        {isSelected && (
                          <Check size={12} className="shrink-0 text-primary" />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
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
          "group inline-flex max-w-[min(220px,46vw)] items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors duration-150",
          hasModelSelected
            ? "font-medium text-foreground"
            : !anyKey
              ? "text-foreground"
              : "text-muted-foreground",
        )}
        style={{
          borderColor: !anyKey
            ? "color-mix(in srgb, var(--primary) 35%, transparent)"
            : "color-mix(in srgb, var(--border) 70%, transparent)",
          background: !anyKey
            ? "color-mix(in srgb, var(--primary) 6%, transparent)"
            : "transparent",
        }}
        aria-label={selected ? `Model: ${selected.label}` : triggerLabel}
      >
        {!anyKey ? (
          <KeyRound
            className="size-3 shrink-0"
            strokeWidth={2}
            style={{
              color: "color-mix(in srgb, var(--primary) 80%, transparent)",
            }}
          />
        ) : showTriggerSpinner ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : null}
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown
          className="size-3 shrink-0 text-muted-foreground/55 transition-transform duration-150 group-data-[state=open]:rotate-180"
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(16rem,calc(100vw-1.5rem))]"
      >
        {!anyKey ? (
          <div className="px-3 py-3.5">
            <MonoLabel>Setup needed</MonoLabel>
            <p
              className="mt-2 text-[12.5px] leading-[1.55]"
              style={{
                fontFamily: "var(--font-reading)",
                color: "color-mix(in srgb, var(--foreground) 75%, transparent)",
              }}
            >
              Add an API key for any provider to load models.
            </p>
            <button
              type="button"
              onClick={() => openSettings()}
              className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
            >
              <KeyRound className="size-3.5" strokeWidth={2} />
              Add a key
            </button>
          </div>
        ) : (
          <>
            {readyBuiltinProviders.map((provider, idx) =>
              renderBuiltinGroup(provider, idx),
            )}
            {renderProfileGroup(readyInferenceProfiles)}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-[12px] text-muted-foreground"
              onClick={() => openSettings()}
            >
              <Settings className="size-3 opacity-60" />
              Add more providers
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
