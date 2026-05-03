import { BookOpen, KeyRound, PenLine, type LucideIcon } from "lucide-react";

const PILLARS: Pillar[] = [
  {
    icon: BookOpen,
    title: "Study anything",
    body: "Open arXiv links, drop in PDFs, or pair with any web page. Every answer stays cited to the passage you highlighted.",
  },
  {
    icon: PenLine,
    title: "Document automatically",
    body: "Turn any chat into a wiki entry with one click. Sessions aggregate into a journal that builds itself.",
  },
  {
    icon: KeyRound,
    title: "Your keys, your machine",
    body: "Bring your own keys for Anthropic, OpenAI, xAI, and OpenRouter, or run locally with Ollama, LM Studio, and llama.cpp.",
  },
];

interface Pillar {
  icon: LucideIcon;
  title: string;
  body: string;
}

export function LandingPillars() {
  return (
    <section className="relative border-t border-border/60 bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:px-10 lg:py-28">
        <div className="grid grid-cols-1 items-end gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <div className="max-w-2xl">
            <div className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              How researchers use it
            </div>
            <h2 className="mt-3 text-[30px] font-semibold leading-[1.08] tracking-[-0.025em] text-foreground sm:text-[36px] lg:text-[40px]">
              A workspace built for the frontier.
            </h2>
          </div>
          <p className="max-w-prose text-[14.5px] leading-relaxed text-muted-foreground lg:text-[15px]">
            Designed for the way researchers actually read: deep, recursive,
            and noisy with half-formed questions. Artifact captures the trail
            you leave behind.
          </p>
        </div>

        <div className="relative mt-14">
          {/* Top hairline rule that the cards visually hang from */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent"
          />
          <div className="grid grid-cols-1 md:grid-cols-3">
            {PILLARS.map(({ icon: Icon, title, body }, i) => (
              <article
                key={title}
                className="group relative px-6 pt-8 pb-2 transition-colors duration-200 md:px-7 md:pt-10 md:[&:not(:last-child)]:border-r md:border-border/60"
              >
                {/* Index numeral */}
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-medium tabular-nums tracking-[0.18em] text-muted-foreground/70 transition-colors duration-200 group-hover:text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--badge-accent-bg)] transition-colors duration-200 group-hover:bg-primary/15">
                    <Icon
                      className="size-[17px] text-primary/70 transition-colors duration-200 group-hover:text-primary"
                      strokeWidth={1.6}
                    />
                  </span>
                </div>
                <h3 className="mt-6 text-[16px] font-semibold tracking-tight text-foreground">
                  {title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                  {body}
                </p>
                {/* Subtle accent line that grows on hover */}
                <span
                  aria-hidden
                  className="mt-6 block h-px w-8 origin-left scale-x-100 bg-primary/30 transition-transform duration-300 group-hover:scale-x-[3]"
                />
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
