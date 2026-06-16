"use client";

import { useMemo } from "react";
import type { RunDetail, RunItem } from "@/lib/evals-types";
import { OUTCOME_META, pct } from "./eval-format";

/**
 * Side-by-side comparison of two runs. The agreement quadrant and flipped list
 * join the two runs on the persisted `itemKey` (not on row index), so they're
 * meaningful even when the runs scored different subsets of questions.
 */
export default function CompareView({
  runA,
  runB,
  domainMax,
  onOpenItem,
}: {
  runA: RunDetail;
  runB: RunDetail;
  domainMax: number;
  onOpenItem: (item: RunItem) => void;
}) {
  const { metrics, agreement, flipped } = useMemo(() => {
    const correctA = new Map(runA.items.map((it) => [it.itemKey, it]));
    const correctB = new Map(runB.items.map((it) => [it.itemKey, it]));

    // metric deltas: overall + any question type present in both
    const mk = (label: string, a: number, b: number) => {
      const d = (a - b) * 100;
      return {
        label,
        a,
        b,
        aWidth: Math.min(100, (a * 100) / domainMax * 100),
        bWidth: Math.min(100, (b * 100) / domainMax * 100),
        deltaLabel: (d >= 0 ? "+" : "") + d.toFixed(1) + " pt",
        positive: d >= 0,
      };
    };
    const metrics = [mk("Overall accuracy", runA.summary.accuracy, runB.summary.accuracy)];
    const bTypes = new Map(runB.summary.byType.map((t) => [t.type, t.accuracy]));
    for (const t of runA.summary.byType) {
      if (bTypes.has(t.type) && metrics.length < 3) {
        metrics.push(mk(t.type, t.accuracy, bTypes.get(t.type)!));
      }
    }

    // agreement on the shared item keys
    let both = 0,
      aOnly = 0,
      bOnly = 0,
      neither = 0;
    const flips: { item: RunItem; aOk: boolean; bOk: boolean }[] = [];
    for (const [key, a] of correctA) {
      const b = correctB.get(key);
      if (!b) continue;
      const aOk = a.outcome === "CORRECT";
      const bOk = b.outcome === "CORRECT";
      if (aOk && bOk) both++;
      else if (aOk && !bOk) {
        aOnly++;
        flips.push({ item: a, aOk, bOk });
      } else if (!aOk && bOk) {
        bOnly++;
        flips.push({ item: a, aOk, bOk });
      } else neither++;
    }
    const shared = both + aOnly + bOnly + neither;
    const agreement = {
      shared,
      cells: [
        { label: "Both correct", count: both, dot: "var(--success)", bg: "color-mix(in srgb, var(--success) 5%, transparent)" },
        { label: "A only", count: aOnly, dot: "var(--primary)", bg: "color-mix(in srgb, var(--primary) 4%, transparent)" },
        { label: "B only", count: bOnly, dot: "var(--warning)", bg: "color-mix(in srgb, var(--warning) 5%, transparent)" },
        { label: "Both wrong", count: neither, dot: "color-mix(in srgb, var(--muted-foreground) 45%, transparent)", bg: "transparent" },
      ],
    };

    return { metrics, agreement, flipped: flips.slice(0, 8) };
  }, [runA, runB, domainMax]);

  return (
    <div className="mt-5" style={{ animation: "fadeIn 200ms ease" }}>
      {/* A / B legend */}
      <div className="mb-3.5 flex items-center gap-2.5">
        <Tag color="var(--primary)" letter="A" label={runA.run.model} />
        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
          vs
        </span>
        <Tag color="var(--warning)" letter="B" label={runB.run.model} />
        <span
          className="ml-auto text-[11px]"
          style={{ color: "var(--muted-foreground)" }}
        >
          Pick B by clicking a bar above.
        </span>
      </div>

      {/* metric deltas */}
      <div className="grid grid-cols-3 gap-3.5">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-xl px-4 py-[15px]"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <div
              className="text-[12px] font-medium"
              style={{ color: "var(--muted-foreground)" }}
            >
              {m.label}
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-[24px] font-bold tracking-[-0.02em] tabular-nums">
                {pct(m.a)}
              </span>
              <span className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
                vs
              </span>
              <span
                className="text-[18px] font-semibold tabular-nums"
                style={{ color: "var(--muted-foreground)" }}
              >
                {pct(m.b)}
              </span>
              <span
                className="ml-auto rounded-full px-[7px] py-0.5 text-[12.5px] font-semibold tabular-nums"
                style={{
                  background: m.positive
                    ? "color-mix(in srgb, var(--success) 13%, transparent)"
                    : "color-mix(in srgb, var(--destructive) 11%, transparent)",
                  color: m.positive
                    ? "color-mix(in srgb, var(--success) 85%, var(--foreground))"
                    : "var(--destructive)",
                }}
              >
                {m.deltaLabel}
              </span>
            </div>
            <Bar width={m.aWidth} color="var(--primary)" className="mt-3" />
            <Bar width={m.bWidth} color="var(--warning)" className="mt-[5px]" />
          </div>
        ))}
      </div>

      {/* agreement + flipped */}
      <div className="mt-3.5 grid grid-cols-[1fr_1.2fr] gap-3.5">
        <div
          className="rounded-xl px-[18px] py-4"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="text-[13px] font-semibold">Where they agree</div>
          <div
            className="mb-3.5 text-[11.5px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            {agreement.shared.toLocaleString()} shared questions
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {agreement.cells.map((c) => (
              <div
                key={c.label}
                className="rounded-[9px] px-[13px] py-3"
                style={{ border: "1px solid var(--border)", background: c.bg }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-[2px]"
                    style={{ background: c.dot }}
                  />
                  <span
                    className="text-[11.5px]"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {c.label}
                  </span>
                </div>
                <div className="mt-1.5 text-[22px] font-bold tabular-nums">
                  {c.count}
                </div>
                <div
                  className="text-[11px] tabular-nums"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {agreement.shared ? pct(c.count / agreement.shared) : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="min-w-0 rounded-xl px-[18px] py-4"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="text-[13px] font-semibold">Flipped questions</div>
          <div
            className="mb-3 text-[11.5px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            One run got these right, the other didn&apos;t
          </div>
          <div className="flex flex-col gap-0.5">
            {flipped.length === 0 ? (
              <div
                className="py-4 text-[12px]"
                style={{ color: "var(--muted-foreground)" }}
              >
                No flipped questions among the shared items.
              </div>
            ) : (
              flipped.map((f) => (
                <button
                  key={f.item.id}
                  type="button"
                  onClick={() => onOpenItem(f.item)}
                  className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-2 text-left hover:[background:var(--muted)]"
                >
                  <span
                    className="max-w-[150px] truncate font-mono text-[11.5px]"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {f.item.itemKey}
                  </span>
                  <span className="flex-1" />
                  <span className="inline-flex flex-none items-center gap-1">
                    <Pill color="var(--primary)" letter="A" />
                    <span
                      className="w-[58px] text-[11px] font-semibold"
                      style={{
                        color: f.aOk
                          ? OUTCOME_META.CORRECT.fg
                          : "var(--muted-foreground)",
                      }}
                    >
                      {f.aOk ? "Correct" : "Wrong"}
                    </span>
                    <Pill color="var(--warning)" letter="B" />
                    <span
                      className="w-[58px] text-[11px] font-semibold"
                      style={{
                        color: f.bOk
                          ? OUTCOME_META.CORRECT.fg
                          : "var(--muted-foreground)",
                      }}
                    >
                      {f.bOk ? "Correct" : "Wrong"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Tag({
  color,
  letter,
  label,
}: {
  color: string;
  letter: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-[7px] text-[12.5px] font-semibold">
      <span
        className="inline-flex size-[18px] items-center justify-center rounded-[5px] text-[10px] font-bold text-white"
        style={{ background: color }}
      >
        {letter}
      </span>
      {label}
    </span>
  );
}

function Pill({ color, letter }: { color: string; letter: string }) {
  return (
    <span
      className="inline-flex size-4 items-center justify-center rounded-[4px] text-[9px] font-bold text-white"
      style={{ background: color }}
    >
      {letter}
    </span>
  );
}

function Bar({
  width,
  color,
  className = "",
}: {
  width: number;
  color: string;
  className?: string;
}) {
  return (
    <div
      className={`relative h-[7px] overflow-hidden rounded-[4px] ${className}`}
      style={{ background: "var(--muted)" }}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-[4px]"
        style={{ width: `${width.toFixed(1)}%`, background: color }}
      />
    </div>
  );
}
