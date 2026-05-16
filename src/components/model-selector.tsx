"use client";

import {
  Fragment,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  Check,
  ChevronDown,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  X,
} from "lucide-react";
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
  hasUsableProvider,
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

type ModelsListResponse = {
  models?: Array<{ id: string; label: string; created?: number }>;
};
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
    .filter(
      (m: { id?: unknown }): m is { id: string; created?: number } =>
        typeof m.id === "string",
    )
    .map((m: { id: string; created?: number }) => ({
      id: m.id,
      label: m.id,
      created: typeof m.created === "number" ? m.created : undefined,
    }));
  return { ok: true, data: { models } };
}

/**
 * Bucket models from one provider into "families" by stripping the
 * common variant suffixes from the model ID. Each bucket has one head
 * (the canonical entry) and a tail of older / dated variants.
 *
 * The patterns intentionally cover only well-known shapes — date stamps
 * (ISO and compact), 4-digit OpenAI-style snapshots, `-preview`, and
 * `-latest`. We DON'T strip context-window or capability suffixes like
 * `-16k` or `-vision` because those are real variants the user may want.
 */
function getFamily(modelId: string): string {
  const stripPatterns = [
    /-\d{4}-\d{2}-\d{2}$/,
    /-\d{8}$/,
    /-\d{4}$/,
    /-preview$/,
    /-latest$/,
    /-stable$/,
  ];
  let id = modelId.toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of stripPatterns) {
      if (p.test(id)) {
        id = id.replace(p, "");
        changed = true;
      }
    }
  }
  return id || modelId.toLowerCase();
}

interface FamilyBucket {
  family: string;
  head: Model;
  tail: Model[];
  /** Max `created` across the bucket. Used to sort families. */
  freshness: number;
}

function bucketByFamily(models: Model[]): FamilyBucket[] {
  const groups = new Map<string, Model[]>();
  for (const m of models) {
    const fam = getFamily(m.modelId);
    const arr = groups.get(fam) ?? [];
    arr.push(m);
    groups.set(fam, arr);
  }

  const buckets: FamilyBucket[] = [];
  for (const [family, entries] of groups) {
    // Pick the head: alias entry (modelId === family) wins because
    // providers like OpenAI use it as a pointer to the latest snapshot,
    // and surfacing "gpt-4o" reads better than "gpt-4o-2024-08-06".
    // Without an alias, fall back to newest by `created`, then lex desc.
    entries.sort((a, b) => {
      const aAlias = a.modelId.toLowerCase() === family ? 1 : 0;
      const bAlias = b.modelId.toLowerCase() === family ? 1 : 0;
      if (aAlias !== bAlias) return bAlias - aAlias;
      const aC = a.created ?? -Infinity;
      const bC = b.created ?? -Infinity;
      if (aC !== bC) return bC - aC;
      return b.modelId.localeCompare(a.modelId);
    });
    const [head, ...tail] = entries;
    const freshness = entries.reduce(
      (acc, m) => (m.created !== undefined && m.created > acc ? m.created : acc),
      0,
    );
    buckets.push({ family, head, tail, freshness });
  }

  // Primary order: newest family first. Fallback: alphabetical, so
  // providers without `created` data (some openai-compatible
  // aggregators) still get a deterministic order instead of whatever
  // order they happened to serve.
  buckets.sort((a, b) => {
    if (a.freshness !== b.freshness) return b.freshness - a.freshness;
    return a.family.localeCompare(b.family);
  });
  return buckets;
}

function modelMatchesQuery(m: Model, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    m.label.toLowerCase().includes(needle) ||
    m.modelId.toLowerCase().includes(needle)
  );
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
  const [searchQuery, setSearchQuery] = useState("");
  // Keys are `${groupKey}::${family}` so two providers can both have a
  // family called "gpt-4" without colliding.
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(
    () => new Set(),
  );

  // Reset transient UI state when the menu closes so the next open
  // starts clean (most users won't continue a half-typed search across
  // sessions, and stale "+older" expansions just clutter). Observed
  // via onOpenChange below so we don't need controlled `open`.
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setSearchQuery("");
      setExpandedFamilies(new Set());
    }
  }, []);

  const toggleFamily = useCallback((key: string) => {
    setExpandedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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
                  created: m.created,
                } satisfies Model;
              }
              return {
                id: `${job.profile.id}-${m.id}`,
                label: `${job.profile.label} · ${m.label}`,
                modelId: m.id,
                provider: job.profile.kind,
                profileId: job.profile.id,
                created: m.created,
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

  const anyKey = hasUsableProvider();

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

  const totalMatchedSelectable = useMemo(() => {
    if (!searchQuery.trim()) return totalSelectable;
    let n = 0;
    for (const s of Object.values(modelsByFetchKey)) {
      if (s?.status !== "ok") continue;
      for (const m of s.models) {
        if (modelMatchesQuery(m, searchQuery)) n++;
      }
    }
    return n;
  }, [modelsByFetchKey, searchQuery, totalSelectable]);

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

  function renderModelItem(model: Model, displayLabel: string) {
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
            isSelected ? "font-medium text-foreground" : "text-foreground/85",
          )}
        >
          {displayLabel}
        </span>
        {isSelected && <Check size={12} className="shrink-0 text-primary" />}
      </DropdownMenuItem>
    );
  }

  function renderModelList(
    groupKey: string,
    models: Model[],
    displayFor: (m: Model) => string,
  ) {
    // Search bypasses family bucketing — the user is looking for
    // something specific, surface every match in a flat list. Caller
    // is responsible for skipping the group entirely when matches are
    // zero; we don't render an empty-state row here.
    if (searchQuery.trim()) {
      const sorted = [...models].sort(
        (a, b) => (b.created ?? 0) - (a.created ?? 0),
      );
      return sorted.map((m) => renderModelItem(m, displayFor(m)));
    }

    const buckets = bucketByFamily(models);
    return buckets.map((bucket) => {
      const expandKey = `${groupKey}::${bucket.family}`;
      const expanded = expandedFamilies.has(expandKey);
      return (
        <Fragment key={bucket.family}>
          {renderModelItem(bucket.head, displayFor(bucket.head))}
          {bucket.tail.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                // Don't let the menu treat this as an item activation
                // (which would close the dropdown).
                e.stopPropagation();
                e.preventDefault();
                toggleFamily(expandKey);
              }}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[10.5px] text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown
                size={10}
                strokeWidth={2}
                className={cn(
                  "transition-transform duration-150",
                  expanded && "rotate-180",
                )}
              />
              {expanded
                ? "Hide older"
                : `${bucket.tail.length} older version${bucket.tail.length === 1 ? "" : "s"}`}
            </button>
          )}
          {expanded &&
            bucket.tail.map((m) => renderModelItem(m, displayFor(m)))}
        </Fragment>
      );
    });
  }

  function renderBuiltinGroup(
    provider: keyof typeof PROVIDER_META,
    groupIndex: number,
  ) {
    const meta = PROVIDER_META[provider];
    const raw = modelsByFetchKey[provider];
    const state: ProviderModelsState = raw ?? { status: "loading" };

    // When searching, skip groups that have no matches entirely so we
    // don't show a wall of provider labels with no items underneath.
    const isSearching = !!searchQuery.trim();
    const visibleModels =
      state.status === "ok"
        ? isSearching
          ? state.models.filter((m) => modelMatchesQuery(m, searchQuery))
          : state.models
        : [];
    if (
      isSearching &&
      state.status === "ok" &&
      visibleModels.length === 0
    ) {
      return null;
    }

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
              No models found. Retry
            </DropdownMenuItem>
          )}

          {state.status === "ok" &&
            visibleModels.length > 0 &&
            renderModelList(provider, visibleModels, (m) => m.label)}
        </DropdownMenuGroup>
      </Fragment>
    );
  }

  function renderProfileGroup(profiles: InferenceProviderProfile[]) {
    if (profiles.length === 0) return null;
    const isSearching = !!searchQuery.trim();

    const renderedProfiles = profiles
      .map((prof) => {
        const raw = modelsByFetchKey[prof.id];
        const state: ProviderModelsState = raw ?? { status: "loading" };
        const displayFor = (m: Model) =>
          m.label.includes("·")
            ? (m.label.split("·").pop()?.trim() ?? m.label)
            : m.label;

        const visibleModels =
          state.status === "ok"
            ? isSearching
              ? state.models.filter((m) => modelMatchesQuery(m, searchQuery))
              : state.models
            : [];
        if (
          isSearching &&
          state.status === "ok" &&
          visibleModels.length === 0
        ) {
          return null;
        }

        return (
          <Fragment key={prof.id}>
            <DropdownMenuLabel className="px-2 pt-1.5 pb-1">
              <MonoLabel>{prof.label}</MonoLabel>
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
              <p className="px-1.5 pb-1 text-[10px] text-muted-foreground">
                No models listed.
              </p>
            )}

            {state.status === "ok" &&
              visibleModels.length > 0 &&
              renderModelList(prof.id, visibleModels, displayFor)}
          </Fragment>
        );
      })
      .filter((node): node is ReactElement => node !== null);

    if (renderedProfiles.length === 0) return null;

    return (
      <Fragment key="inference">
        <DropdownMenuSeparator />
        <DropdownMenuGroup>{renderedProfiles}</DropdownMenuGroup>
      </Fragment>
    );
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
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
            {totalSelectable > 0 && (
              <div className="sticky top-0 z-10 -mx-1 -mt-1 mb-1 border-b border-border/60 bg-popover/95 px-1.5 pt-1.5 pb-1.5 backdrop-blur-sm">
                <div className="relative">
                  <Search
                    size={11}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                    strokeWidth={2}
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      // Stop the menu's built-in typeahead from
                      // intercepting normal typing. Esc still bubbles
                      // so the menu can close.
                      if (
                        e.key.length === 1 ||
                        e.key === "Backspace" ||
                        e.key === "Delete"
                      ) {
                        e.stopPropagation();
                      }
                    }}
                    placeholder="Search models…"
                    className="h-7 w-full rounded-md border border-border/60 bg-background/60 pl-6 pr-6 text-[11.5px] text-foreground placeholder:text-muted-foreground/60 outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/40"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Search models"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded text-muted-foreground/60 hover:text-foreground"
                      aria-label="Clear search"
                    >
                      <X size={11} strokeWidth={2} />
                    </button>
                  )}
                </div>
              </div>
            )}
            {readyBuiltinProviders.map((provider, idx) =>
              renderBuiltinGroup(provider, idx),
            )}
            {renderProfileGroup(readyInferenceProfiles)}

            {searchQuery.trim() && totalMatchedSelectable === 0 && (
              <p className="px-2 py-2 text-[11.5px] text-muted-foreground/80">
                No models match &ldquo;{searchQuery.trim()}&rdquo;.
              </p>
            )}

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
