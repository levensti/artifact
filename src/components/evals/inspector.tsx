"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import MarkdownMessage from "@/components/markdown-message";
import type { ItemResponse, RunItem } from "@/lib/evals-types";
import { OUTCOME_META, typeBadge } from "./eval-format";

function splitQuestionOptions(raw: string | null): {
  stem: string | null;
  options: Array<{ label: string; text: string }>;
} {
  if (!raw) return { stem: null, options: [] };
  const lines = raw.split(/\r?\n/);
  const options: Array<{ label: string; text: string }> = [];
  const stem: string[] = [];
  let current: { label: string; parts: string[] } | null = null;

  for (const line of lines) {
    const match = line.match(/^\s*(?:\(?([A-D])\)?[.)]|([A-D])[:：])\s+(.+)$/);
    if (match) {
      if (current) {
        options.push({ label: current.label, text: current.parts.join("\n").trim() });
      }
      current = { label: match[1] ?? match[2], parts: [match[3]] };
    } else if (current) {
      current.parts.push(line);
    } else {
      stem.push(line);
    }
  }
  if (current) {
    options.push({ label: current.label, text: current.parts.join("\n").trim() });
  }

  if (options.length < 2) return { stem: raw.trim(), options: [] };
  return { stem: stem.join("\n").trim() || null, options };
}

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
  const question = splitQuestionOptions(item.question);

  return (
    <>
      <aside
        className="fixed inset-0 z-50 flex flex-col"
        style={{
          background: "var(--card)",
          boxShadow: "var(--shadow-lg)",
          animation: "fadeIn 150ms ease",
        }}
      >
        <div
          className="flex items-start gap-3 px-7 pb-3.5 pt-[18px]"
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

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-7 pb-10 pt-[22px]">
          <div className="mx-auto max-w-[1180px]">
          {/* target vs prediction */}
          <div className="grid grid-cols-2 gap-3.5">
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

          {/* question + options */}
          {question.stem ? (
            <div className="mt-5">
              <div
                className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                style={{ color: "var(--muted-foreground)" }}
              >
                Question
              </div>
              <div
                className="rounded-[11px] px-[18px] py-4 text-[14px]"
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--reader-mat)",
                  lineHeight: 1.6,
                }}
              >
                <div className="whitespace-pre-wrap">{question.stem}</div>
                {question.options.length ? (
                  <div className="mt-4 grid gap-2.5">
                    {question.options.map((option) => (
                      <div
                        key={option.label}
                        className="grid grid-cols-[30px_minmax(0,1fr)] gap-2.5 rounded-[9px] px-3 py-2.5"
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--background)",
                        }}
                      >
                        <span
                          className="flex size-[24px] items-center justify-center rounded-full font-mono text-[12px] font-semibold"
                          style={{
                            background: "var(--secondary)",
                            color: "var(--secondary-foreground)",
                          }}
                        >
                          {option.label}
                        </span>
                        <span className="whitespace-pre-wrap pt-px">
                          {option.text}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

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
              className="rounded-[11px] px-[22px] py-5 text-[14px]"
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
        </div>
      </aside>
    </>
  );
}
