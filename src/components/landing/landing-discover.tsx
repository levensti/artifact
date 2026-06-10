import { SectionHeader } from "@/components/landing/landing-section";

/**
 * Discover — the first full-bleed ink band. The brand indigo as a surface,
 * with the discover feed mocked as paper cards floating on it.
 */
export function LandingDiscover() {
  return (
    <section id="discover" className="landing-ink relative overflow-hidden">
      <div
        className="landing-dots-inverse absolute inset-0"
        style={{
          maskImage:
            "linear-gradient(180deg, black 0%, transparent 45%, transparent 100%)",
        }}
        aria-hidden
      />
      <div className="relative mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-x-16 gap-y-12 px-6 py-20 sm:py-24 md:px-10 lg:grid-cols-[5fr_6fr]">
        <SectionHeader
          tone="ink"
          num="01"
          kicker="Discover"
          title="Know what to read next."
          lede="Describe a topic, a method, an open question. A research agent searches the literature and the open web, reads what it finds, and hands back a ranked shortlist — papers and lab blogs together, each with a one-line reason to care."
        />

        <DiscoverFeed />
      </div>
    </section>
  );
}

function DiscoverFeed() {
  return (
    <div className="flex flex-col gap-2.5">
      {/* Query row */}
      <div
        className="flex items-center gap-2.5 rounded-lg border px-3.5 py-3"
        style={{
          borderColor:
            "color-mix(in srgb, var(--primary-foreground) 18%, transparent)",
          background:
            "color-mix(in srgb, var(--primary-foreground) 7%, transparent)",
        }}
      >
        <SearchGlyph />
        <span
          className="font-mono text-[12.5px]"
          style={{
            color:
              "color-mix(in srgb, var(--primary-foreground) 88%, transparent)",
          }}
        >
          speculative decoding for long-context inference
        </span>
        <span
          className="landing-caret"
          style={{ background: "var(--primary-foreground)" }}
          aria-hidden
        />
        <span
          className="ml-auto hidden items-center gap-1.5 font-sans text-[10.5px] font-medium sm:inline-flex"
          style={{
            color:
              "color-mix(in srgb, var(--primary-foreground) 60%, transparent)",
          }}
        >
          <span
            className="landing-pulse-dot"
            style={{ background: "var(--primary-foreground)" }}
            aria-hidden
          />
          Reading 14 sources
        </span>
      </div>

      <Pick
        rank="1"
        title="Medusa: Simple LLM Inference Acceleration Framework"
        source="arXiv:2401.10774"
        rationale="Multiple decoding heads, no draft model — the closest thing to a drop-in answer."
      />
      <Pick
        rank="2"
        title="EAGLE: Speculative Sampling Requires Rethinking Feature Uncertainty"
        source="arXiv:2401.15077"
        rationale="Explains why naive draft–verify breaks down exactly in long-context regimes."
      />
      <Pick
        rank="3"
        title="How speculative decoding works in vLLM"
        source="vllm.ai · blog"
        rationale="The production tradeoffs you'll actually hit, from the team running it at scale."
      />
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
    <div
      className="grid grid-cols-[28px_1fr] gap-x-3 rounded-lg border bg-card p-3.5 pr-4"
      style={{
        borderColor:
          "color-mix(in srgb, var(--primary-foreground) 14%, transparent)",
        boxShadow: "0 10px 30px -12px rgb(0 0 0 / 0.35)",
      }}
    >
      <span
        className="pt-0.5 font-mono text-[13px] font-medium"
        style={{
          color: "color-mix(in srgb, var(--primary) 60%, transparent)",
          fontFeatureSettings: '"tnum"',
        }}
      >
        {rank}
      </span>
      <div>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h4 className="m-0 font-sans text-[13px] font-semibold leading-[1.35] tracking-[-0.008em] text-card-foreground">
            {title}
          </h4>
          <span
            className="font-mono text-[10px] uppercase"
            style={{
              letterSpacing: "0.06em",
              color:
                "color-mix(in srgb, var(--muted-foreground) 75%, transparent)",
            }}
          >
            {source}
          </span>
        </div>
        <p
          className="mt-1 mb-0 text-[11.5px] leading-[1.5]"
          style={{
            fontFamily: "var(--font-reading)",
            color:
              "color-mix(in srgb, var(--muted-foreground) 95%, transparent)",
          }}
        >
          {rationale}
        </p>
      </div>
    </div>
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
      className="size-3.5 shrink-0"
      aria-hidden
      style={{
        color: "color-mix(in srgb, var(--primary-foreground) 60%, transparent)",
      }}
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m13 13-2.5-2.5" />
    </svg>
  );
}
