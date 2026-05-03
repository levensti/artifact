import { ArrowRight, Sparkles } from "lucide-react";
import { BrandGlyph } from "@/components/brand-panel";

export interface LandingHeroProps {
  signupHref: string;
  githubUrl: string;
}

export function LandingHero({ signupHref, githubUrl }: LandingHeroProps) {
  return (
    <section className="relative overflow-hidden">
      {/* Ambient background — soft primary-tinted radial + brand watermark */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_-10%,color-mix(in_srgb,var(--primary)_8%,transparent),transparent_55%),radial-gradient(circle_at_90%_110%,color-mix(in_srgb,var(--primary)_5%,transparent),transparent_50%)]"
      />
      <svg
        viewBox="4 4 24 24"
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-24 size-[520px] text-primary opacity-[0.04]"
      >
        <path
          d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z"
          fill="currentColor"
        />
        <circle cx="22" cy="10" r="3.2" fill="currentColor" />
      </svg>

      <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-14 px-6 pt-16 pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-20 lg:px-10 lg:pt-24 lg:pb-28">
        {/* Left: copy + CTA */}
        <div className="relative max-w-xl animate-in fade-in slide-in-from-bottom-2 duration-500">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <Sparkles className="size-3 text-primary/70" strokeWidth={2} />
            Open source · BYOK
          </span>

          <h1 className="mt-6 text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-foreground sm:text-[52px] lg:text-[60px]">
            Stay at the
            <br />
            <span className="bg-gradient-to-br from-primary via-primary/90 to-primary/70 bg-clip-text text-transparent">
              research frontier.
            </span>
          </h1>

          <p className="mt-6 max-w-[34ch] text-[15px] leading-relaxed text-muted-foreground sm:text-base">
            An AI-paired workspace for researchers. Read papers deeply, journal
            your learnings automatically, and never lose a thread.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href={signupHref}
              className="group inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-[14px] font-medium text-primary-foreground shadow-[var(--shadow-sm)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[var(--shadow-primary)] active:translate-y-px"
            >
              Get started
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </a>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[14px] font-medium text-foreground/75 transition-colors duration-150 hover:bg-muted hover:text-foreground"
            >
              <GithubMark className="size-4" />
              View on GitHub
            </a>
          </div>

          <p className="mt-6 text-[12.5px] text-muted-foreground/80">
            Free · MIT licensed · Bring your own keys
          </p>
        </div>

        {/* Right: stylized review mock */}
        <HeroMock />
      </div>
    </section>
  );
}

function HeroMock() {
  return (
    <div className="relative hidden md:block">
      {/* Stage shadow */}
      <div
        aria-hidden
        className="absolute inset-x-6 bottom-2 h-12 rounded-full bg-primary/10 blur-2xl"
      />

      <div className="relative mx-auto w-full max-w-[520px] rotate-[-1deg] animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Paper card */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[var(--shadow-lg)]">
          {/* Header chrome */}
          <div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/40 px-4 py-2.5">
            <span className="size-2 rounded-full bg-foreground/15" />
            <span className="size-2 rounded-full bg-foreground/15" />
            <span className="size-2 rounded-full bg-foreground/15" />
            <div className="ml-3 h-4 flex-1 rounded bg-background/70" />
          </div>

          {/* Paper body */}
          <div className="space-y-5 px-7 py-7">
            {/* Title block */}
            <div>
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--badge-accent-bg)] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[var(--badge-accent-fg)] uppercase">
                arXiv · 1706.03762
              </div>
              <div className="text-[17px] font-semibold leading-tight tracking-tight text-foreground">
                Attention Is All You Need
              </div>
              <div className="mt-1.5 text-[11.5px] text-muted-foreground">
                Vaswani, Shazeer, Parmar, Uszkoreit, Jones, Gomez, Kaiser,
                Polosukhin
              </div>
            </div>

            {/* Faux body lines (skeleton style w/ one annotated highlight) */}
            <div className="space-y-2.5">
              <SkeletonLine widths={["w-full", "w-[92%]"]} />
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
                <span className="h-2.5 w-16 rounded bg-muted" />
                <span className="rounded bg-[var(--badge-accent-bg)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--badge-accent-fg)]">
                  multi-head attention
                </span>
                <span className="h-2.5 w-24 rounded bg-muted" />
                <span className="h-2.5 w-12 rounded bg-muted" />
                <span className="h-2.5 w-20 rounded bg-muted" />
              </div>
              <SkeletonLine widths={["w-[88%]", "w-[60%]"]} />
              <SkeletonLine widths={["w-[78%]"]} />
            </div>

            {/* Footer meta */}
            <div className="flex items-center justify-between pt-1 text-[10.5px] text-muted-foreground/80">
              <span>3 annotations · 2 questions</span>
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-success" />
                Auto-journaling
              </span>
            </div>
          </div>
        </div>

        {/* Floating chat bubble — question */}
        <div
          className="absolute -right-6 top-20 w-[260px] animate-in fade-in slide-in-from-right-2 rotate-[2deg] rounded-xl border border-border/70 bg-card p-3 shadow-[var(--shadow-md)] duration-700"
          style={{ animationDelay: "180ms", animationFillMode: "backwards" }}
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BrandGlyph className="size-2.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                You
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-foreground">
                What&apos;s the intuition behind multi-head attention?
              </p>
            </div>
          </div>
        </div>

        {/* Floating chat bubble — reply preview */}
        <div
          className="absolute -bottom-8 -left-6 w-[280px] animate-in fade-in slide-in-from-left-2 rotate-[-2deg] rounded-xl border border-border/70 bg-card p-3 shadow-[var(--shadow-md)] duration-700"
          style={{ animationDelay: "360ms", animationFillMode: "backwards" }}
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-[var(--badge-accent-bg)] text-primary">
              <Sparkles className="size-2.5" strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                Assistant
              </div>
              <div className="mt-1 space-y-1.5">
                <SkeletonLine widths={["w-full"]} thin />
                <SkeletonLine widths={["w-[88%]"]} thin />
                <SkeletonLine widths={["w-[64%]"]} thin />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonLine({
  widths,
  thin = false,
}: {
  widths: string[];
  thin?: boolean;
}) {
  const h = thin ? "h-2" : "h-2.5";
  return (
    <div className="flex items-center gap-1.5">
      {widths.map((w, i) => (
        <span key={i} className={`${h} ${w} rounded bg-muted`} />
      ))}
    </div>
  );
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="currentColor"
      className={className}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.13 0 1.54-.01 2.78-.01 3.16 0 .31.21.68.8.56C20.21 21.39 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}
