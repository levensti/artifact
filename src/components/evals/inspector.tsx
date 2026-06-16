"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import MarkdownMessage from "@/components/markdown-message";
import type { ItemResponse, RunItem } from "@/lib/evals-types";
import { OUTCOME_META, typeBadge } from "./eval-format";

/**
 * Per-question inspector. Shows what's actually stored for an item — target,
 * prediction, outcome, and the model's raw response (fetched on open). The
 * design's A–D option list and latency/token stats are omitted because the
 * harness doesn't persist the question options or per-item timing.
 */
export default function Inspector({
  item,
  onClose,
}: {
  item: RunItem | null;
  onClose: () => void;
}) {
  // Track which item the loaded response belongs to so a stale response from a
  // previous open never renders, and `loading` derives from the match (no
  // synchronous setState reset in the effect).
  const [loaded, setLoaded] = useState<{
    id: string;
    resp: ItemResponse | null;
  } | null>(null);

  useEffect(() => {
    if (!item) return;
    let alive = true;
    fetch(`/api/evals/items/${item.id}`)
      .then((r) => (r.ok ? (r.json() as Promise<ItemResponse>) : null))
      .then((d) => {
        if (alive) setLoaded({ id: item.id, resp: d });
      })
      .catch(() => {
        if (alive) setLoaded({ id: item.id, resp: null });
      });
    return () => {
      alive = false;
    };
  }, [item]);

  if (!item) return null;

  const ready = loaded?.id === item.id;
  const resp = ready ? loaded!.resp : null;
  const loading = !ready;

  const m = OUTCOME_META[item.outcome];
  const tb = item.type ? typeBadge(item.type) : null;
  const ok = item.outcome === "CORRECT";

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{ background: "rgba(20,18,14,0.18)", animation: "fadeIn 150ms ease" }}
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-[520px] max-w-[92vw] flex-col"
        style={{
          background: "var(--card)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "var(--shadow-lg)",
          animation: "slideInRight 220ms var(--ease-out)",
        }}
      >
        <div
          className="flex items-start gap-3 px-5 pb-3.5 pt-[18px]"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold"
                style={{ background: m.bg, color: m.fg }}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: m.fg }}
                />
                {m.label}
              </span>
              {tb ? (
                <span
                  className="rounded-full px-[7px] py-[2px] text-[10px] font-semibold"
                  style={{ background: tb.bg, color: tb.fg }}
                >
                  {item.type}
                </span>
              ) : null}
            </div>
            <div
              className="mt-2 truncate font-mono text-[12px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              {item.itemKey}
            </div>
            {item.paperId ? (
              <div
                className="mt-1 text-[11.5px]"
                style={{ color: "var(--muted-foreground)" }}
              >
                paper {item.paperId}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-[30px] flex-none items-center justify-center rounded-[7px]"
            style={{
              border: "1px solid var(--border)",
              background: "var(--background)",
              color: "var(--muted-foreground)",
            }}
          >
            <X className="size-[15px]" strokeWidth={2} />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-[18px]">
          {/* target vs prediction */}
          <div className="grid grid-cols-2 gap-2.5">
            <div
              className="rounded-[10px] px-[15px] py-[13px]"
              style={{
                border: "1px solid var(--border)",
                background: "var(--reader-mat)",
              }}
            >
              <div
                className="text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: "var(--muted-foreground)" }}
              >
                Target
              </div>
              <div
                className="mt-1.5 font-mono text-[24px] font-medium tracking-[0.04em]"
              >
                {item.gold || "—"}
              </div>
            </div>
            <div
              className="rounded-[10px] px-[15px] py-[13px]"
              style={{
                border: ok
                  ? "1px solid color-mix(in srgb, var(--success) 35%, transparent)"
                  : "1px solid var(--border)",
                background: ok
                  ? "color-mix(in srgb, var(--success) 8%, transparent)"
                  : "var(--reader-mat)",
              }}
            >
              <div
                className="text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: "var(--muted-foreground)" }}
              >
                Prediction
              </div>
              <div
                className="mt-1.5 font-mono text-[24px] font-medium tracking-[0.04em]"
                style={{
                  color: ok
                    ? "color-mix(in srgb, var(--success) 88%, var(--foreground))"
                    : item.pred
                      ? "var(--foreground)"
                      : "var(--muted-foreground)",
                }}
              >
                {item.pred || "—"}
              </div>
            </div>
          </div>

          {/* model response */}
          <div className="mt-5">
            <div className="mb-2.5 flex items-center justify-between">
              <span
                className="text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: "var(--muted-foreground)" }}
              >
                Model response
              </span>
              {resp?.note ? (
                <span
                  className="text-[11px]"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  {resp.note}
                </span>
              ) : null}
            </div>
            <div
              className="rounded-[11px] px-[18px] py-4 text-[14px]"
              style={{
                border: "1px solid var(--border)",
                background: "var(--background)",
                lineHeight: 1.65,
              }}
            >
              {loading ? (
                <span style={{ color: "var(--muted-foreground)" }}>Loading…</span>
              ) : resp?.response ? (
                <MarkdownMessage content={resp.response} />
              ) : (
                <span style={{ color: "var(--muted-foreground)" }}>
                  No response was recorded for this item.
                </span>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
