"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, Check, Loader2 } from "lucide-react";
import {
  FALLBACK_MODELS,
  PROVIDER_ORDER,
  PROVIDER_META,
  type Model,
} from "@/lib/models";
import { cn } from "@/lib/utils";
import { getApiKey, KEYS_UPDATED_EVENT } from "@/lib/keys";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ModelSelectorProps {
  selected: Model | null;
  onSelect: (model: Model) => void;
}

export default function ModelSelector({ selected, onSelect }: ModelSelectorProps) {
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<Model[]>(FALLBACK_MODELS);
  const [keysVersion, setKeysVersion] = useState(0);

  useEffect(() => {
    const onKeys = () => setKeysVersion((v) => v + 1);
    window.addEventListener(KEYS_UPDATED_EVENT, onKeys);
    return () => window.removeEventListener(KEYS_UPDATED_EVENT, onKeys);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      setLoading(true);
      const merged = [...FALLBACK_MODELS];

      for (const provider of PROVIDER_ORDER) {
        const apiKey = getApiKey(provider);
        if (!apiKey) continue;
        try {
          const response = await fetch("/api/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider, apiKey }),
          });
          if (!response.ok) continue;
          const data = (await response.json()) as { models?: Array<{ id: string; label: string }> };
          const remote = (data.models ?? []).map((m) => ({
            id: `${provider}-${m.id}`,
            label: m.label,
            modelId: m.id,
            provider,
          })) satisfies Model[];

          for (const model of remote) {
            if (!merged.some((x) => x.provider === model.provider && x.modelId === model.modelId)) {
              merged.push(model);
            }
          }
        } catch {
          // Keep fallback list if provider API is unavailable.
        }
      }

      if (!cancelled) {
        setModels(merged);
        setLoading(false);
      }
    }

    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [keysVersion]);

  const groups = useMemo(
    () =>
      PROVIDER_ORDER.map((provider) => ({
        provider,
        models: models.filter((m) => m.provider === provider),
      })),
    [models],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center h-7 gap-1 px-2 text-xs text-muted-foreground font-normal rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
        aria-label={selected ? `Model: ${selected.label}` : "Select model"}
      >
        {selected ? selected.label : "Select model"}
        {loading ? <Loader2 size={10} className="animate-spin" /> : <ChevronDown size={10} />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {groups.map(({ provider, models }, groupIndex) => (
          <Fragment key={provider}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[11px] font-medium text-foreground">
                {PROVIDER_META[provider].label}
              </DropdownMenuLabel>
              <p className="px-1.5 pb-1.5 text-[10px] text-muted-foreground leading-snug">
                Uses your {PROVIDER_META[provider].keyHint}.
              </p>
              {models.length > 0 ? (
                models.map((model) => (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => onSelect(model)}
                    className="flex items-center justify-between gap-2"
                  >
                    <span
                      className={cn(
                        "text-xs",
                        selected?.id === model.id && "text-primary font-medium",
                      )}
                    >
                      {model.label}
                    </span>
                    {selected?.id === model.id && (
                      <Check size={12} className="text-primary shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  Add API key to load models
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
