"use client";

import { ArrowRight, BookMarked, Sparkles } from "lucide-react";
import type { WikiPage } from "@/lib/wiki";
import { MonoLabel } from "@/components/folio";

export interface JournalEntry {
  kind: "session" | "digest";
  page: WikiPage;
  date: Date;
}

interface JournalCardProps {
  entry: JournalEntry;
  onOpen: (slug: string) => void;
}

function firstParagraph(md: string): string {
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) continue;
    if (t.startsWith(">")) return t.replace(/^>\s*/, "").slice(0, 320);
    return t.slice(0, 320);
  }
  return "";
}

function countSections(md: string): Record<string, number> {
  const counts: Record<string, number> = {};
  let current: string | null = null;
  for (const line of md.split("\n")) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) {
      current = h[1].toLowerCase();
      counts[current] = 0;
      continue;
    }
    if (current && /^\s*-\s+/.test(line)) {
      counts[current] = (counts[current] ?? 0) + 1;
    }
  }
  return counts;
}

function sessionChips(content: string): Array<{ label: string; count: number }> {
  const counts = countSections(content);
  const chips: Array<{ label: string; count: number }> = [];
  const papers = counts["papers"] ?? 0;
  const moments = counts["moments"] ?? 0;
  const questions = counts["open questions"] ?? 0;
  if (papers)
    chips.push({ label: papers === 1 ? "paper" : "papers", count: papers });
  if (moments) chips.push({ label: "moments", count: moments });
  if (questions)
    chips.push({
      label: questions === 1 ? "question" : "questions",
      count: questions,
    });
  return chips;
}

/**
 * Timeline entry card. Full-width article on the journal timeline — a
 * kind/time header, a display-weight title, the opening paragraph, and a
 * derived stat-chip footer. Digest entries are tinted in the indigo accent
 * so the weekly synthesis reads as a distinct beat on the timeline.
 */
export default function JournalCard({ entry, onOpen }: JournalCardProps) {
  const isDigest = entry.kind === "digest";
  const excerpt = firstParagraph(entry.page.content);
  const chips = isDigest
    ? [{ label: "weekly digest", count: 0 }]
    : sessionChips(entry.page.content);
  const dateLabel = entry.date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(entry.date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" }),
  });
  const Icon = isDigest ? Sparkles : BookMarked;
  const typeLabel = isDigest ? "Weekly digest" : "Session";

  return (
    <button
      type="button"
      onClick={() => onOpen(entry.page.slug)}
      className="group flex h-full w-full flex-col rounded-xl border px-[22px] py-[18px] text-left transition-all duration-200 hover:-translate-y-px hover:shadow-[var(--shadow-md)]"
      style={{
        borderColor: isDigest
          ? "color-mix(in srgb, var(--primary) 16%, transparent)"
          : "var(--border)",
        background: isDigest
          ? "color-mix(in srgb, var(--primary) 5%, var(--card))"
          : "var(--card)",
      }}
    >
      {/* Kind + time */}
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="inline-flex size-5 items-center justify-center rounded-md"
          style={{
            background: isDigest
              ? "color-mix(in srgb, var(--primary) 12%, transparent)"
              : "var(--muted)",
            color: isDigest
              ? "color-mix(in srgb, var(--primary) 78%, transparent)"
              : "color-mix(in srgb, var(--muted-foreground) 90%, transparent)",
          }}
        >
          <Icon className="size-3" strokeWidth={1.8} />
        </span>
        <MonoLabel tone={isDigest ? "accent" : "muted"}>{typeLabel}</MonoLabel>
        <span className="flex-1" />
        <span
          className="font-mono text-[10px] tabular-nums"
          style={{
            letterSpacing: "0.06em",
            color:
              "color-mix(in srgb, var(--muted-foreground) 75%, transparent)",
          }}
        >
          {dateLabel}
        </span>
      </div>

      {/* Title */}
      <h3
        className="text-[18px] font-semibold leading-[1.3] tracking-[-0.014em] text-foreground text-balance transition-colors"
        style={{ margin: 0 }}
      >
        {entry.page.title}
      </h3>

      {/* Excerpt */}
      {excerpt ? (
        <p
          className="mt-2 line-clamp-3 text-[14.5px] leading-[1.6]"
          style={{
            fontFamily: "var(--font-reading)",
            color: "color-mix(in srgb, var(--foreground) 66%, transparent)",
          }}
        >
          {excerpt}
        </p>
      ) : null}

      {/* Stat chips */}
      <div
        className="mt-auto flex items-center pt-3.5 text-[11.5px]"
        style={{
          borderTop: isDigest
            ? "1px solid color-mix(in srgb, var(--primary) 14%, transparent)"
            : "1px solid var(--border)",
          color: "color-mix(in srgb, var(--muted-foreground) 90%, transparent)",
          fontFeatureSettings: '"tnum"',
        }}
      >
        {chips.length > 0 ? (
          chips.map((c, i) => (
            <span key={c.label} className="inline-flex items-center">
              {i > 0 ? (
                <span className="mx-2.5 opacity-50" style={{ color: "var(--muted-foreground)" }}>
                  ·
                </span>
              ) : null}
              {c.count > 0 ? (
                <span
                  className="font-semibold"
                  style={{
                    color:
                      "color-mix(in srgb, var(--foreground) 72%, transparent)",
                  }}
                >
                  {c.count}
                </span>
              ) : null}
              <span className={c.count > 0 ? "ml-1" : undefined}>{c.label}</span>
            </span>
          ))
        ) : (
          <span
            className="italic"
            style={{
              fontFamily: "var(--font-reading)",
              color:
                "color-mix(in srgb, var(--muted-foreground) 70%, transparent)",
            }}
          >
            Reading session
          </span>
        )}
        <span className="flex-1" />
        <ArrowRight
          className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
          strokeWidth={1.75}
          style={{
            color: isDigest
              ? "color-mix(in srgb, var(--primary) 80%, transparent)"
              : "color-mix(in srgb, var(--muted-foreground) 55%, transparent)",
          }}
        />
      </div>
    </button>
  );
}
