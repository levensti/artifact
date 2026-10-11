import { SectionHeader } from "@/components/landing/landing-section";

/**
 * Discover: copy on the left, the discover feed on the right as a single
 * bordered panel with a query bar and hairline-divided ranked results.
 */
export function LandingDiscover() {
  return (
    <section id="discover" className="border-t border-border">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-x-16 gap-y-12 px-6 py-20 sm:py-24 md:px-10 lg:grid-cols-[5fr_6fr]">
        <SectionHeader
          num="01"
          kicker="Discover"
          title="Know what to read next."
          lede="Describe a topic, a method, or an open question. A research agent searches the literature and the open web, reads what it finds, and returns a ranked shortlist of papers and lab blogs, each with a one-line reason to care."
        />

        <DiscoverFeed />
      </div>
    </section>
  );
}

function DiscoverFeed() {
  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      {/* Query row */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <SearchGlyph />
        <span className="font-mono text-[12.5px] text-foreground">
          speculative decoding for long-context inference
        </span>
        <span className="landing-caret" aria-hidden />
        <span className="ml-auto hidden items-center gap-1.5 font-mono text-[11px] text-muted-foreground sm:inline-flex">
          <span className="landing-pulse-dot" aria-hidden />
          reading 14 sources
        </span>
      </div>

      <ol className="divide-y divide-border">
        <Pick
          rank="01"
          title="Medusa: Simple LLM Inference Acceleration Framework"
          source="arXiv:2401.10774"
          rationale="Multiple decoding heads, no draft model. The closest thing to a drop-in answer."
        />
        <Pick
          rank="02"
          title="EAGLE: Speculative Sampling Requires Rethinking Feature Uncertainty"
          source="arXiv:2401.15077"
          rationale="Explains why naive draft and verify breaks down exactly in long-context regimes."
        />
        <Pick
          rank="03"
          title="How speculative decoding works in vLLM"
          source="vllm.ai / blog"
          rationale="The production tradeoffs you'll actually hit, from the team running it at scale."
        />
      </ol>
    </div>
  );
}

function Pick({
  rank,
  title,
  source,
  rationale,
}: {
  rank: string;
  title: string;
  source: string;
  rationale: string;
}) {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-x-3 px-4 py-3.5">
      <span
        className="pt-px font-mono text-[11.5px] text-muted-foreground"
        style={{ fontFeatureSettings: '"tnum"' }}
      >
        {rank}
      </span>
      <div>
        <h4 className="m-0 font-sans text-[13.5px] font-medium leading-[1.4] tracking-[-0.006em] text-card-foreground">
          {title}
        </h4>
        <p className="mt-1 mb-0 text-[12.5px] leading-[1.5] text-muted-foreground">
          {rationale}
        </p>
        <span className="mt-1.5 inline-block font-mono text-[10.5px] text-muted-foreground/80">
          {source}
        </span>
      </div>
    </li>
  );
}

function SearchGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0 text-muted-foreground"
      aria-hidden
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m13 13-2.5-2.5" />
    </svg>
  );
}
