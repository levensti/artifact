"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { RunDetail, RunItem } from "@/lib/evals-types";
import {
  OUTCOME_META,
  OUTCOME_ORDER,
  STATUS_META,
  dateTimeLabel,
  pct,
  shortRunId,
  typeBadge,
} from "./eval-format";

const TABLE_GRID =
  "44px minmax(140px,1.2fr) minmax(0,0.8fr) 78px 60px 60px 104px";

export default function RunDetailView({
  detail,
  domainMax,
  selectedItemId,
  onOpenItem,
}: {
  detail: RunDetail;
  domainMax: number;
  selectedItemId: string | null;
  onOpenItem: (item: RunItem) => void;
}) {
  const { run, summary, items } = detail;
  const status = STATUS_META[run.status];
  const failed = run.status === "FAILED";

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");

  const types = useMemo(
    () => summary.byType.map((t) => t.type),
    [summary.byType],
  );

  const filtered = useMemo(
    () =>
      items.filter(
        (it) =>
          (typeFilter === "all" || it.type === typeFilter) &&
          (outcomeFilter === "all" || it.outcome === outcomeFilter),
      ),
    [items, typeFilter, outcomeFilter],
  );

  return (
    <div>
      {/* sub-header */}
      <div className="mx-0.5 mb-3.5 mt-[22px] flex items-center gap-3">
        <span className="text-[14px] font-semibold">{run.model}</span>
        <span
          className="rounded-[5px] px-[7px] py-[2px] font-mono text-[12px]"
          style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
        >
          {run.recipe}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-[9px] py-[3px] text-[11.5px] font-medium"
          style={{ background: status.bg, color: status.fg }}
        >
          <span
            className="size-1.5 rounded-full"
            style={{
              background: status.fg,
              animation: status.animate
                ? "pulseDot 1.4s ease-in-out infinite"
                : "none",
            }}
          />
          {status.label}
        </span>
        <span
          className="ml-auto text-[11.5px] tabular-nums"
          style={{ color: "var(--muted-foreground)" }}
        >
          {dateTimeLabel(run.createdAt)} · run {shortRunId(run.id)}
        </span>
      </div>

      {/* FAILED banner */}
      {failed ? (
        <div
          className="mb-4 flex items-start gap-3 rounded-xl px-[18px] py-4"
          style={{
            background: "color-mix(in srgb, var(--destructive) 7%, var(--card))",
            border:
              "1px solid color-mix(in srgb, var(--destructive) 28%, transparent)",
          }}
        >
          <AlertTriangle
            className="mt-px size-5 flex-none"
            strokeWidth={1.75}
            style={{ color: "var(--destructive)" }}
          />
          <div>
            <div
              className="text-[13.5px] font-semibold"
              style={{
                color: "color-mix(in srgb, var(--destructive) 88%, var(--foreground))",
              }}
            >
              Run failed before completing
            </div>
            <div
              className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed"
              style={{ color: "var(--muted-foreground)" }}
            >
              The {summary.total} item{summary.total === 1 ? "" : "s"} written
              before the failure are kept and shown below.
            </div>
          </div>
        </div>
      ) : null}

      {/* metric cards */}
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3.5">
        {/* overall accuracy */}
        <Card>
          <div className="flex items-center justify-between">
            <span
              className="text-[12px] font-medium"
              style={{ color: "var(--muted-foreground)" }}
            >
              Overall accuracy
            </span>
            <span
              className="text-[11px] tabular-nums"
              style={{ color: "var(--muted-foreground)" }}
            >
              {summary.correct} / {summary.total} correct
            </span>
          </div>
          <div className="mt-[7px] flex items-baseline gap-2">
            <span className="text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums">
              {pct(summary.accuracy)}
            </span>
          </div>
          <div
            className="relative mt-4 h-2.5 rounded-[5px]"
            style={{ background: "var(--muted)" }}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-[5px]"
              style={{
                width: `${Math.min(100, (summary.accuracy * 100) / domainMax * 100).toFixed(1)}%`,
                background: "var(--primary)",
                transition: "width 220ms var(--ease-out)",
              }}
            />
          </div>
          <div
            className="mt-[7px] flex justify-between text-[10.5px] tabular-nums"
            style={{ color: "var(--muted-foreground)" }}
          >
            <span>0%</span>
            <span>{(domainMax / 2).toFixed(0)}%</span>
            <span>{domainMax}%</span>
          </div>
        </Card>

        {/* by question type */}
        <Card className="flex flex-col">
          <span
            className="text-[12px] font-medium"
            style={{ color: "var(--muted-foreground)" }}
          >
            By question type
          </span>
          {summary.byType.length ? (
            <div className="mt-3.5 flex flex-col gap-3">
              {summary.byType.map((t, i) => {
                const tb = typeBadge(t.type);
                return (
                  <div key={t.type}>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="inline-flex items-center gap-1.5 text-[12px]">
                        <span
                          className="rounded-full px-1.5 py-px text-[10px] font-semibold"
                          style={{ background: tb.bg, color: tb.fg }}
                        >
                          {t.type}
                        </span>
                        <span
                          className="text-[11px]"
                          style={{ color: "var(--muted-foreground)" }}
                        >
                          {t.n} q
                        </span>
                      </span>
                      <span className="text-[13px] font-bold tabular-nums">
                        {pct(t.accuracy)}
                      </span>
                    </div>
                    <div
                      className="relative h-[7px] rounded-[4px]"
                      style={{ background: "var(--muted)" }}
                    >
                      <span
                        className="absolute inset-y-0 left-0 rounded-[4px]"
                        style={{
                          width: `${Math.min(100, (t.accuracy * 100) / domainMax * 100).toFixed(1)}%`,
                          background:
                            i === 0
                              ? "var(--primary)"
                              : "color-mix(in srgb, var(--primary) 55%, var(--muted))",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className="mt-3.5 text-[11.5px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              No question-type metadata for this run.
            </div>
          )}
        </Card>

        {/* outcome mix */}
        <Card className="flex flex-col">
          <span
            className="text-[12px] font-medium"
            style={{ color: "var(--muted-foreground)" }}
          >
            Outcome mix
          </span>
          <div
            className="mt-3.5 flex h-[11px] overflow-hidden rounded-md"
            style={{ background: "var(--muted)" }}
          >
            {OUTCOME_ORDER.map((o) => {
              const c = summary.outcomeCounts[o];
              if (!c) return null;
              return (
                <span
                  key={o}
                  title={`${OUTCOME_META[o].label}: ${c}`}
                  style={{
                    width: `${((c / summary.total) * 100).toFixed(2)}%`,
                    background: OUTCOME_META[o].dot,
                  }}
                />
              );
            })}
          </div>
          <div className="mt-3.5 grid grid-cols-2 gap-x-3.5 gap-y-[7px]">
            {OUTCOME_ORDER.map((o) => (
              <div key={o} className="flex items-center gap-[7px]">
                <span
                  className="size-2 flex-none rounded-[2px]"
                  style={{ background: OUTCOME_META[o].dot }}
                />
                <span
                  className="flex-1 text-[11.5px]"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {OUTCOME_META[o].label}
                </span>
                <span className="text-[11.5px] font-semibold tabular-nums">
                  {summary.outcomeCounts[o]}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* per-question table */}
      <div
        className="mt-[18px] overflow-hidden rounded-xl"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          className="flex items-center gap-2.5 px-4 py-[13px]"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span className="text-[13px] font-semibold">Per-question results</span>
          <span
            className="text-[11.5px] tabular-nums"
            style={{ color: "var(--muted-foreground)" }}
          >
            {filtered.length === summary.total
              ? `${summary.total} questions`
              : `${filtered.length} of ${summary.total}`}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <FilterButton
              active={typeFilter === "all"}
              onClick={() => setTypeFilter("all")}
              label="All types"
            />
            {types.map((t) => (
              <FilterButton
                key={t}
                active={typeFilter === t}
                onClick={() => setTypeFilter(t)}
                label={t}
              />
            ))}
            <span
              className="mx-0.5 h-[18px] w-px"
              style={{ background: "var(--border)" }}
            />
            <FilterButton
              active={outcomeFilter === "all"}
              onClick={() => setOutcomeFilter("all")}
              label="All"
            />
            {OUTCOME_ORDER.map((o) => (
              <FilterButton
                key={o}
                active={outcomeFilter === o}
                onClick={() => setOutcomeFilter(o)}
                title={OUTCOME_META[o].label}
                dot={OUTCOME_META[o].dot}
              />
            ))}
          </div>
        </div>

        <div
          className="grid px-4 py-[9px]"
          style={{
            gridTemplateColumns: TABLE_GRID,
            borderBottom: "1px solid var(--border)",
            background: "var(--reader-mat)",
          }}
        >
          {["#", "Item key", "Paper", "Type", "Gold", "Pred", "Outcome"].map(
            (h, i) => (
              <span
                key={h}
                className="text-[10.5px] font-semibold uppercase tracking-[0.06em]"
                style={{
                  color: "var(--muted-foreground)",
                  textAlign: i === 4 || i === 5 ? "center" : "left",
                }}
              >
                {h}
              </span>
            ),
          )}
        </div>

        <div className="scroll-thin max-h-[540px] overflow-y-auto">
          {filtered.map((it, i) => {
            const m = OUTCOME_META[it.outcome];
            const tb = it.type ? typeBadge(it.type) : null;
            const sel = it.id === selectedItemId;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onOpenItem(it)}
                className="grid w-full items-center px-4 py-[9px] text-left hover:[background:var(--muted)]"
                style={{
                  gridTemplateColumns: TABLE_GRID,
                  borderBottom:
                    "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
                  background: sel
                    ? "color-mix(in srgb, var(--primary) 7%, transparent)"
                    : "transparent",
                }}
              >
                <span
                  className="text-[11.5px] tabular-nums"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {i + 1}
                </span>
                <span
                  className="truncate pr-2.5 font-mono text-[11.5px]"
                  style={{
                    color: "color-mix(in srgb, var(--primary) 70%, var(--foreground))",
                  }}
                >
                  {it.itemKey}
                </span>
                <span
                  className="truncate pr-3.5 text-[12.5px]"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {it.paperId ? `paper ${it.paperId}` : "—"}
                </span>
                <span>
                  {tb ? (
                    <span
                      className="rounded-full px-[7px] py-[2px] text-[10px] font-semibold"
                      style={{ background: tb.bg, color: tb.fg }}
                    >
                      {it.type}
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted-foreground)" }}>—</span>
                  )}
                </span>
                <span className="text-center font-mono text-[12.5px] font-medium">
                  {it.gold || "—"}
                </span>
                <span
                  className="text-center font-mono text-[12.5px] font-medium"
                  style={{
                    color:
                      it.outcome === "CORRECT"
                        ? "color-mix(in srgb, var(--success) 85%, var(--foreground))"
                        : it.pred
                          ? "var(--foreground)"
                          : "var(--muted-foreground)",
                  }}
                >
                  {it.pred || "—"}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 text-[11.5px] font-medium"
                  style={{ color: m.fg }}
                >
                  <span
                    className="size-[7px] flex-none rounded-full"
                    style={{ background: m.dot }}
                  />
                  {m.label}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <div
              className="p-9 text-center text-[12.5px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              No questions match these filters.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl px-[18px] py-[17px] ${className}`}
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {children}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  title,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label?: string;
  title?: string;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex h-[26px] items-center gap-1.5 rounded-[7px] px-2.5 text-[11.5px] font-medium"
      style={{
        border: "1px solid var(--border)",
        background: active ? "var(--secondary)" : "var(--background)",
        color: active ? "var(--foreground)" : "var(--muted-foreground)",
      }}
    >
      {dot ? (
        <span className="size-[7px] rounded-[2px]" style={{ background: dot }} />
      ) : null}
      {label}
    </button>
  );
}
