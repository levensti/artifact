"use client";

import type { ReactNode } from "react";
import type { Recommendation } from "@/lib/discover-types";
import MarkdownMessage from "./markdown-message";
import RecommendationCard from "./recommendation-card";

/**
 * Building blocks shared by a brief's live and finished states, so a run that
 * finishes keeps the same shape on screen: Overview, then Reading list, then
 * the research trace.
 */

/** A titled section of the brief. Sentence-case heading with an optional
 *  muted count; the content sits beneath at a consistent gap. */
export function BriefSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="flex items-baseline gap-2 text-[15px] font-semibold tracking-[-0.01em] text-foreground">
        {title}
        {count ? (
          <span className="text-[13px] font-normal tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** The explainer: the one piece of the brief written to be read. */
export function OverviewProse({ prose }: { prose: string }) {
  return (
    <div
      className="max-w-[68ch] text-[16px] leading-[1.7] text-foreground/90"
      style={{ fontFamily: "var(--font-reading)" }}
    >
      <MarkdownMessage content={prose} />
    </div>
  );
}

/** The ranked reading list. */
export function ReadingList({ recs }: { recs: Recommendation[] }) {
  return (
    <ol
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      {recs.map((rec) => (
        <li key={rec.id}>
          <RecommendationCard rec={rec} />
        </li>
      ))}
    </ol>
  );
}

export function picksCount(n: number): string {
  return `${n} ${n === 1 ? "source" : "sources"}`;
}
