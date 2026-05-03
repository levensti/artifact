import { BookOpen, KeyRound, PenLine, type LucideIcon } from "lucide-react";

const PILLARS: Pillar[] = [
  {
    icon: BookOpen,
    title: "Study anything",
    body: "Open arXiv links, drop in PDFs, or pair with any web page. Selection-scoped chat keeps every answer cited back to the source.",
  },
  {
    icon: PenLine,
    title: "Document automatically",
    body: "One click promotes a chat into a wiki entry. Learnings aggregate across sessions into a journal that builds itself.",
  },
  {
    icon: KeyRound,
    title: "Your keys, your machine",
    body: "Bring your own keys for Anthropic, OpenAI, xAI, OpenRouter — or run locally with Ollama, LM Studio, or llama.cpp.",
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
        <div className="max-w-2xl">
          <div className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            What Artifact gives you
          </div>
          <h2 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[32px]">
            A workspace that thinks alongside you.
          </h2>
          <p className="mt-3 max-w-prose text-[14.5px] leading-relaxed text-muted-foreground">
            Designed for the way researchers actually read — deep, recursive,
            and noisy with half-formed questions. Artifact captures the trail
            you leave behind.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="group relative overflow-hidden rounded-xl border border-border/70 bg-card px-6 py-6 transition-all duration-200 hover:-translate-y-px hover:border-primary/25 hover:shadow-[var(--shadow-primary)]"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--badge-accent-bg)] transition-colors duration-200 group-hover:bg-primary/15">
                <Icon
                  className="size-[18px] text-primary/70 transition-colors duration-200 group-hover:text-primary"
                  strokeWidth={1.6}
                />
              </div>
              <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-foreground">
                {title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
