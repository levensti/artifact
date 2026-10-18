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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cite the reading list in the overview: after the first mention of each
 * pick's title, add its rank as a link to the entry (`[2](#pick-<id>)`,
 * rendered as a superscript by MarkdownMessage), the way an essay cites its
 * bibliography. Tries the full title, then the part before a colon, since
 * the writer often shortens titles. Mentions already inside a markdown link
 * are left alone.
 */
export function citePicks(prose: string, recs: Recommendation[]): string {
  let out = prose;
  for (const rec of recs) {
    const full = rec.title.trim();
    const short = full.split(":")[0].trim();
    for (const title of short !== full && short.length >= 12 ? [full, short] : [full]) {
      if (title.length < 8) continue;
      const re = new RegExp(`(?<!\\[)${escapeRegExp(title)}(?![^\\[\\]]*\\])`, "i");
      const m = re.exec(out);
      if (!m) continue;
      const end = m.index + m[0].length;
      out = `${out.slice(0, end)}[${rec.rank}](#pick-${rec.id})${out.slice(end)}`;
      break;
    }
  }
  return out;
}

/** The explainer: the one piece of the brief written to be read. Its first
 *  paragraph is the lede; picks it names carry their reading-list rank. */
export function OverviewProse({
  prose,
  recs = [],
}: {
  prose: string;
  recs?: Recommendation[];
}) {
  return (
    <div className="brief-overview max-w-[62ch] text-foreground/85">
      <MarkdownMessage content={citePicks(prose, recs)} />
    </div>
  );
}

/** The ranked reading list: hairline-separated entries, each an anchor the
 *  overview's citations jump to. */
export function ReadingList({ recs }: { recs: Recommendation[] }) {
  return (
    <ol className="divide-y divide-border border-y border-border">
      {recs.map((rec) => (
        <li key={rec.id} id={`pick-${rec.id}`} className="scroll-mt-24 rounded-md">
          <RecommendationCard rec={rec} />
        </li>
      ))}
    </ol>
  );
}

export function picksCount(n: number): string {
  return `${n} ${n === 1 ? "source" : "sources"}`;
}
