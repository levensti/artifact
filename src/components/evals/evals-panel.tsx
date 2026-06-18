"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, GitCompare } from "lucide-react";
import type {
  EvalOverview,
  RunDetail,
  RunItem,
  RunSummary,
} from "@/lib/evals-types";
import {
  STATUS_META,
  accuracyDomainMax,
  groupLabel,
  pct,
  timeLabel,
} from "./eval-format";
import RunDetailView from "./run-detail";
import CompareView from "./compare-view";
import Inspector from "./inspector";

/** Most recent run; the server returns runs newest-first. */
function defaultRun(runs: RunSummary[]): RunSummary | null {
  return runs[0] ?? null;
}

export default function EvalsPanel() {
  const [overview, setOverview] = useState<EvalOverview | null>(null);
  const [benchmarkId, setBenchmarkId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [compareRunId, setCompareRunId] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [selected, setSelected] = useState<RunItem | null>(null);

  const [detailA, setDetailA] = useState<RunDetail | null>(null);
  const [detailB, setDetailB] = useState<RunDetail | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load the overview for the selected benchmark (or the default benchmark on
  // first mount), then reconcile the selected/compare runs.
  useEffect(() => {
    let alive = true;
    const qs = benchmarkId ? `?benchmark=${benchmarkId}` : "";
    fetch(`/api/evals${qs}`)
      .then((r) => {
        if (r.status === 403) {
          if (alive) setForbidden(true);
          return null;
        }
        return r.ok ? (r.json() as Promise<EvalOverview>) : null;
      })
      .then((data) => {
        if (!alive || !data) return;
        setOverview(data);
        setLoaded(true);
        if (!benchmarkId && data.benchmark) setBenchmarkId(data.benchmark.id);
        setRunId((cur) => {
          if (cur && data.runs.some((r) => r.id === cur)) return cur;
          return defaultRun(data.runs)?.id ?? null;
        });
        setCompareRunId((cur) => {
          if (cur && data.runs.some((r) => r.id === cur)) return cur;
          const def = defaultRun(data.runs);
          return (
            data.runs.find(
              (r) => r.id !== def?.id && r.status === "COMPLETED",
            )?.id ?? null
          );
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [benchmarkId]);

  // Load the selected run's detail. Stale results are filtered at render time
  // by matching run id, so there's no synchronous clear here.
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    fetch(`/api/evals/runs/${runId}`)
      .then((r) => (r.ok ? (r.json() as Promise<RunDetail>) : null))
      .then((d) => {
        if (alive) setDetailA(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [runId]);

  // Load the comparison run's detail (only while comparing).
  useEffect(() => {
    if (!compare || !compareRunId) return;
    let alive = true;
    fetch(`/api/evals/runs/${compareRunId}`)
      .then((r) => (r.ok ? (r.json() as Promise<RunDetail>) : null))
      .then((d) => {
        if (alive) setDetailB(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [compare, compareRunId]);

  const selectBenchmark = useCallback((id: string) => {
    setBenchmarkId(id);
    setRunId(null);
    setCompareRunId(null);
    setCompare(false);
    setSelected(null);
  }, []);

  const onBarOrRunSelect = useCallback(
    (id: string) => {
      if (compare) setCompareRunId(id);
      else {
        setRunId(id);
        setSelected(null);
      }
    },
    [compare],
  );

  // Only render a loaded detail when it matches the current selection, so a
  // stale fetch result never flashes the wrong run.
  const showA = detailA && detailA.run.id === runId ? detailA : null;
  const showB = detailB && detailB.run.id === compareRunId ? detailB : null;

  const runs = useMemo(() => overview?.runs ?? [], [overview]);
  const domainMax = useMemo(
    () =>
      accuracyDomainMax(
        runs
          .filter((r) => r.accuracy != null)
          .map((r) => r.accuracy as number),
      ),
    [runs],
  );

  // chronological (oldest → newest) for the rail
  const chrono = useMemo(() => runs.slice().reverse(), [runs]);

  // group runs by day for the sidebar
  const runGroups = useMemo(() => {
    const order: string[] = [];
    const by: Record<string, RunSummary[]> = {};
    for (const r of runs) {
      const g = groupLabel(r.createdAt);
      if (!by[g]) {
        by[g] = [];
        order.push(g);
      }
      by[g].push(r);
    }
    return order.map((label) => ({ label, runs: by[label] }));
  }, [runs]);

  if (forbidden) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="text-[15px] font-semibold">Evals are restricted</div>
          <div
            className="mt-1 text-[13px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            This dashboard is only available to the workspace owner.
          </div>
        </div>
      </div>
    );
  }

  const bench = overview?.benchmark;

  return (
    <div
      className="flex h-full w-full overflow-hidden"
      style={{
        background: "var(--background)",
        color: "var(--foreground)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* ============ LEFT RAIL: benchmarks + runs ============ */}
      <aside
        className="flex w-[244px] flex-none flex-col"
        style={{
          background: "var(--sidebar)",
          borderRight: "1px solid var(--sidebar-border)",
        }}
      >
        <div className="px-2 pb-0.5 pt-2">
          <div
            className="px-2 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Benchmarks
          </div>
          {(overview?.benchmarks ?? []).map((b) => {
            const active = b.id === benchmarkId;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => selectBenchmark(b.id)}
                className="relative mb-px flex w-full items-center gap-2.5 rounded-[7px] px-2 py-[7px] text-left hover:[background:var(--sidebar-accent)]"
                style={{ background: active ? "var(--sidebar-accent)" : "transparent" }}
              >
                <span
                  className="absolute -left-1 top-1/2 h-[15px] w-[2.5px] -translate-y-1/2 rounded-[2px]"
                  style={{ background: active ? "var(--primary)" : "transparent" }}
                />
                <Sparkles
                  className="size-[15px]"
                  strokeWidth={1.75}
                  style={{
                    color: active ? "var(--primary)" : "var(--muted-foreground)",
                  }}
                />
                <span
                  className="min-w-0 flex-1 truncate text-[13px]"
                  style={{ fontWeight: active ? 600 : 500 }}
                >
                  {b.name}
                </span>
                <span
                  className="text-[11px] tabular-nums"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {b.runCount}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="mx-2.5 my-2 h-px opacity-70"
          style={{ background: "var(--sidebar-border)" }}
        />

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <div
            className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Runs · {bench?.name ?? ""}
          </div>
          {runGroups.map((g) => (
            <div key={g.label} className="mt-1.5">
              <div
                className="px-2 pb-[3px] pt-[5px] text-[11px] font-semibold"
                style={{ color: "var(--muted-foreground)" }}
              >
                {g.label}
              </div>
              {g.runs.map((r) => {
                const active = r.id === runId && !compare;
                const isB = compare && r.id === compareRunId;
                const sm = STATUS_META[r.status];
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onBarOrRunSelect(r.id)}
                    className="relative mb-px flex w-full items-center gap-2 rounded-[7px] px-2 py-[7px] text-left hover:[background:var(--sidebar-accent)]"
                    style={{
                      background: active
                        ? "var(--sidebar-accent)"
                        : isB
                          ? "color-mix(in srgb, var(--warning) 9%, transparent)"
                          : "transparent",
                    }}
                  >
                    <span
                      className="absolute -left-1 top-1/2 h-[18px] w-[2.5px] -translate-y-1/2 rounded-[2px]"
                      style={{
                        background: active
                          ? "var(--primary)"
                          : isB
                            ? "var(--warning)"
                            : "transparent",
                      }}
                    />
                    <span
                      className="size-[7px] flex-none rounded-full"
                      style={{
                        background: sm.dot,
                        animation: sm.animate
                          ? "pulseDot 1.4s ease-in-out infinite"
                          : "none",
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[12.5px] font-medium"
                        style={{ color: active ? "var(--primary)" : "var(--foreground)" }}
                      >
                        {r.model}
                      </span>
                      <span
                        className="mt-px block truncate text-[11px]"
                        style={{ color: "var(--muted-foreground)" }}
                      >
                        {r.recipe} · {timeLabel(r.createdAt)}
                      </span>
                    </span>
                    <span
                      className="text-[12px] font-semibold tabular-nums"
                      style={{
                        color:
                          r.status === "FAILED"
                            ? "var(--destructive)"
                            : active
                              ? "var(--primary)"
                              : "var(--foreground)",
                      }}
                    >
                      {r.status === "FAILED"
                        ? "fail"
                        : r.accuracy != null
                          ? pct(r.accuracy)
                          : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {loaded && runs.length === 0 ? (
            <div
              className="px-2 py-6 text-[12px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              No runs yet for this benchmark.
            </div>
          ) : null}
        </div>
      </aside>

      {/* ============ MAIN ============ */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className="flex flex-none items-start gap-5 px-7 pb-4 pt-[18px]"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <h1 className="m-0 text-[22px] font-bold tracking-[-0.022em]">
                {bench?.name ?? "Evals"}
              </h1>
              {bench ? (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
                  style={{
                    background: "var(--muted)",
                    color: "var(--muted-foreground)",
                  }}
                >
                  {bench.questionCount.toLocaleString()} questions
                </span>
              ) : null}
            </div>
            {bench ? (
              <p
                className="m-0 mt-1.5 max-w-[680px] text-[13px] leading-normal"
                style={{ color: "var(--muted-foreground)", textWrap: "pretty" }}
              >
                {bench.description}
              </p>
            ) : null}
          </div>
          {runs.length >= 2 ? (
            <button
              type="button"
              onClick={() => {
                setCompare((c) => !c);
                setSelected(null);
              }}
              className="inline-flex h-[34px] flex-none items-center gap-1.5 rounded-lg px-[13px] text-[13px] font-medium"
              style={{
                border: compare ? "1px solid var(--primary)" : "1px solid var(--border)",
                background: compare ? "var(--primary)" : "var(--background)",
                color: compare ? "var(--primary-foreground)" : "var(--foreground)",
              }}
            >
              <GitCompare className="size-3.5" strokeWidth={2} />
              {compare ? "Exit compare" : "Compare runs"}
            </button>
          ) : null}
        </header>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="max-w-[1180px] px-7 pb-10 pt-[22px]">
            {/* accuracy-over-runs rail */}
            {chrono.length > 0 ? (
              <div
                className="rounded-xl px-[18px] pb-3.5 pt-4"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div className="mb-3.5 flex items-center gap-2">
                  <span className="text-[13px] font-semibold">
                    Accuracy over runs
                  </span>
                  <span
                    className="text-[11.5px]"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {chrono.length} run{chrono.length === 1 ? "" : "s"}
                    {compare ? " · click a bar to pick B" : ""}
                  </span>
                </div>
                <div className="flex h-32 items-end gap-2.5 pl-[34px]">
                  {chrono.map((r) => {
                    const acc = r.accuracy != null ? r.accuracy * 100 : 0;
                    const failed = r.status === "FAILED";
                    const active = r.id === runId;
                    const isB = compare && r.id === compareRunId;
                    let fill = "color-mix(in srgb, var(--primary) 26%, var(--muted))";
                    let border = "none";
                    let tag = "";
                    if (failed) {
                      fill = "color-mix(in srgb, var(--destructive) 16%, transparent)";
                      border = "1px dashed color-mix(in srgb, var(--destructive) 45%, transparent)";
                    } else if (compare && active) {
                      fill = "var(--primary)";
                      tag = "A";
                    } else if (isB) {
                      fill = "var(--warning)";
                      tag = "B";
                    } else if (active && !compare) {
                      fill = "var(--primary)";
                    }
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => onBarOrRunSelect(r.id)}
                        title={`${r.model} · ${r.recipe} · ${failed ? "FAILED" : r.accuracy != null ? pct(r.accuracy) : "—"}`}
                        className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5 border-none bg-transparent p-0"
                      >
                        <span
                          className="text-[10.5px] font-semibold tabular-nums"
                          style={{
                            color:
                              active || isB
                                ? "var(--foreground)"
                                : "var(--muted-foreground)",
                          }}
                        >
                          {failed ? "—" : r.accuracy != null ? pct(r.accuracy) : "—"}
                        </span>
                        <span
                          className="relative w-full max-w-[46px] rounded-t-[5px]"
                          style={{
                            height: `${Math.max(2, Math.min(100, (acc / domainMax) * 100)).toFixed(1)}%`,
                            background: fill,
                            border,
                            borderRadius: "5px 5px 2px 2px",
                            transition: "height 200ms var(--ease-out)",
                            boxShadow:
                              active && !compare
                                ? "0 0 0 3px color-mix(in srgb, var(--primary) 18%, transparent)"
                                : "none",
                          }}
                        >
                          {tag ? (
                            <span
                              className="absolute left-1/2 top-1 -translate-x-1/2 text-[9px] font-bold tracking-[0.04em] text-white"
                            >
                              {tag}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className="max-w-[54px] truncate text-[10px]"
                          style={{ color: "var(--muted-foreground)" }}
                        >
                          {r.model.length > 9 ? r.model.slice(0, 8) + "…" : r.model}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* compare or single-run — gate on matching ids so a just-changed
                selection never shows the previous run's data */}
            {compare && showA && showB ? (
              <CompareView
                runA={showA}
                runB={showB}
                domainMax={domainMax}
                onOpenItem={setSelected}
              />
            ) : !compare && showA ? (
              <RunDetailView
                detail={showA}
                domainMax={domainMax}
                selectedItemId={selected?.id ?? null}
                onOpenItem={setSelected}
              />
            ) : (
              <div
                className="mt-6 text-[13px]"
                style={{ color: "var(--muted-foreground)" }}
              >
                {loaded ? "Select a run." : "Loading…"}
              </div>
            )}
          </div>
        </div>
      </main>

      <Inspector item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
