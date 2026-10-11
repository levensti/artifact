import { LandingWorkspace } from "@/components/landing/landing-workspace";
import { ArrowRight } from "@/components/landing/landing-icons";

export interface LandingHeroProps {
  signupHref: string;
  githubUrl: string;
}

const FACTS: Array<{ value: string; label: string }> = [
  { value: "arXiv, PDF, web", label: "Sources you can open" },
  { value: "Full text", label: "In the assistant's context" },
  { value: "Free daily", label: "Usage, no key required" },
  { value: "MIT", label: "Licensed, self-hostable" },
];

/**
 * Cover: left-aligned headline and a concrete one-line description, two
 * actions, a row of plain facts, then the workspace miniature. Flat paper
 * throughout; the mock carries the visual weight.
 */
export function LandingHero({ signupHref, githubUrl }: LandingHeroProps) {
  return (
    <section id="cover" aria-labelledby="cover-title">
      <div className="mx-auto max-w-[1120px] px-6 pt-20 sm:pt-28 md:px-10">
        <div className="max-w-[720px]">
          <p className="landing-label">
            <b>[■]</b> Open source research workspace
          </p>

          <h1 id="cover-title" className="landing-h1 mt-5">
            Read papers with an assistant that has{" "}
            <span className="frontier">the whole text.</span>
          </h1>

          <p className="landing-lede mt-6 max-w-[560px] text-[17px]">
            Find what to read next, open any arXiv paper, PDF, or web page,
            and ask questions that come back with citations to the exact
            passage.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <a
              href={signupHref}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-[14px] font-medium text-background transition-opacity duration-150 hover:opacity-85"
            >
              Start reading free
              <ArrowRight className="size-[13px]" />
            </a>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-10 items-center rounded-md border border-border bg-card px-4 text-[14px] font-medium text-foreground transition-colors duration-150 hover:bg-muted"
            >
              Read the source
            </a>
          </div>
        </div>

        <dl className="landing-grid mt-16 grid grid-cols-2 bg-card md:grid-cols-4">
          {FACTS.map((f) => (
            <div key={f.label} className="px-5 py-4">
              <dt className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                {f.value}
              </dt>
              <dd className="mt-0.5 text-[12.5px] text-muted-foreground">
                {f.label}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 pb-20 sm:pb-24">
          <LandingWorkspace />
        </div>
      </div>
    </section>
  );
}
