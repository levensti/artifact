"use client";

import { BookMarked, Sparkles } from "lucide-react";
import type { WikiPage } from "@/lib/wiki";
import { cn } from "@/lib/utils";
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
    if (t.startsWith(">")) return t.replace(/^>\s*/, "").slice(0, 220);
    return t.slice(0, 220);
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

function relativeDateLabel(d: Date): string {
  const now = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (isSameDay(d, now)) return "Today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, yesterday)) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export default function JournalCard({ entry, onOpen }: JournalCardProps) {
  const isDigest = entry.kind === "digest";
  const excerpt = firstParagraph(entry.page.content);
  const chips = isDigest ? [] : sessionChips(entry.page.content);
  const dateLabel = relativeDateLabel(entry.date);
  const Icon = isDigest ? Sparkles : BookMarked;
  const typeLabel = isDigest ? "Digest" : "Session";

  return (
    <button
      type="button"
      onClick={() => onOpen(entry.page.slug)}
      className={cn(
        "group flex w-full flex-col rounded-lg border bg-card px-4 py-4 text-left transition-all duration-200",
        "hover:-translate-y-px hover:shadow-[var(--shadow-sm)]",
      )}
      style={{
        borderColor: isDigest
          ? "color-mix(in srgb, var(--primary) 18%, transparent)"
          : "color-mix(in srgb, var(--border) 70%, transparent)",
        background: isDigest
          ? "color-mix(in srgb, var(--primary) 4%, var(--card))"
          : "var(--card)",
      }}
    >
      {/* Top row: kind + date with subtle chip glyph */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-flex size-[18px] items-center justify-center rounded-md"
            style={{
              background: isDigest
                ? "color-mix(in srgb, var(--primary) 14%, transparent)"
                : "var(--badge-accent-bg)",
              color: "color-mix(in srgb, var(--primary) 65%, transparent)",
            }}
          >
            <Icon className="size-2.5" strokeWidth={1.8} />
          </span>
          <MonoLabel>{typeLabel}</MonoLabel>
        </span>
        <span
          className="font-mono text-[10px] tabular-nums"
          style={{
            color: "color-mix(in srgb, var(--muted-foreground) 70%, transparent)",
            letterSpacing: "0.06em",
          }}
        >
          {dateLabel}
        </span>
      </div>

      {/* Title */}
      <h3
        className="mt-3 line-clamp-2 text-[14px] font-semibold leading-[1.35] tracking-[-0.01em] text-foreground/90 transition-colors group-hover:text-foreground"
        style={{ minHeight: "38px" }}
      >
        {entry.page.title}
      </h3>

      {/* Excerpt — Inter for the reading flavor */}
      <p
        className="mt-1.5 line-clamp-2 text-[12px] leading-[1.55]"
        style={{
          fontFamily: "var(--font-reading)",
          color: "color-mix(in srgb, var(--muted-foreground) 90%, transparent)",
          minHeight: "37px",
        }}
      >
        {excerpt}
      </p>

      {/* Stats row */}
      <div
        className="mt-3 flex flex-wrap items-center gap-x-2.5 pt-2.5 text-[10.5px]"
        style={{
          borderTop:
            "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
          minHeight: "28px",
          color: "color-mix(in srgb, var(--muted-foreground) 70%, transparent)",
          fontFeatureSettings: '"tnum"',
        }}
      >
        {chips.length > 0 ? (
          chips.map((c, i) => (
            <span key={c.label} className="inline-flex items-center">
              {i > 0 ? <span className="mr-2.5 opacity-30">·</span> : null}
              <span
                className="font-semibold"
                style={{
                  color:
                    "color-mix(in srgb, var(--foreground) 75%, transparent)",
                }}
              >
                {c.count}
              </span>
              <span className="ml-1">{c.label}</span>
            </span>
          ))
        ) : (
          <span
            className="italic"
            style={{
              fontFamily: "var(--font-reading)",
              color:
                "color-mix(in srgb, var(--muted-foreground) 60%, transparent)",
            }}
          >
            {isDigest ? "Weekly digest" : "Reading session"}
          </span>
        )}
      </div>
    </button>
  );
}
