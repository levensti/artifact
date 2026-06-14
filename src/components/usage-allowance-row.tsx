"use client";

import { useEffect, useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/client/api";

type UsageResponse = {
  platformOpenRouter: boolean;
  usage:
    | {
        enabled: false;
        hourlyLimit: number;
        dailyLimit: number;
      }
    | {
        enabled: true;
        hourly: { remaining: number; limit: number };
        daily: { remaining: number; limit: number };
        effectiveRemaining: number;
        available: boolean;
      };
};

interface UsageAllowanceRowProps {
  active: boolean;
}

export function UsageAllowanceRow({ active }: UsageAllowanceRowProps) {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void apiFetch<UsageResponse>("/api/usage", {
      signal: controller.signal,
    })
      .then((next) => setData(next))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Unable to load usage");
      })
    return () => controller.abort();
  }, [active]);

  const usage = data?.usage;
  const meteredUsage = usage?.enabled ? usage : null;
  const remaining = meteredUsage?.effectiveRemaining ?? 0;
  const limit = meteredUsage
    ? Math.min(meteredUsage.hourly.limit, meteredUsage.daily.limit)
    : 1;
  const pct = meteredUsage
    ? Math.max(0, Math.min(100, (remaining / limit) * 100))
    : 0;
  const loading = active && !data && !error;

  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Gauge size={15} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13.5px] font-semibold tracking-[-0.005em] text-foreground">
              Free Artifact usage
            </p>
            {loading ? (
              <RefreshCw
                size={13}
                className="shrink-0 animate-spin text-muted-foreground/55"
                strokeWidth={2}
              />
            ) : null}
          </div>

          {error ? (
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              Usage is unavailable right now.
            </p>
          ) : !data ? (
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              Loading allowance...
            </p>
          ) : !data.platformOpenRouter ? (
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              Platform usage is not configured for this deployment.
            </p>
          ) : !meteredUsage ? (
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              Platform usage is available and not metered in this environment.
            </p>
          ) : (
            <>
              <p
                className="mt-1 text-[12px] leading-snug"
                style={{
                  fontFamily: "var(--font-reading)",
                  color: meteredUsage.available
                    ? "color-mix(in srgb, var(--primary) 82%, transparent)"
                    : "color-mix(in srgb, var(--destructive) 82%, transparent)",
                }}
              >
                {meteredUsage.available
                  ? `${formatTokens(remaining)} tokens remaining`
                  : "Free allowance is refilling"}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>Hour: {formatTokens(meteredUsage.hourly.remaining)}</span>
                <span>Day: {formatTokens(meteredUsage.daily.remaining)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTokens(tokens: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: tokens >= 10_000 ? 0 : 1,
  }).format(tokens);
}
