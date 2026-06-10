import { MonoLabel } from "@/components/folio";
import { LandingWorkspace } from "@/components/landing/landing-workspace";
import { ArrowRight, GithubMark } from "@/components/landing/landing-icons";

export interface LandingHeroProps {
  signupHref: string;
  githubUrl: string;
}

/**
 * Cover: centered display type on the warm reader mat, with the workspace
 * miniature as the single showpiece. The mat (plus its dot grid) ends
 * mid-mockup — a white strip sits behind the lower half so the workspace
 * appears to lift off the hero and into the page.
 */
export function LandingHero({ signupHref, githubUrl }: LandingHeroProps) {
  return (
    <section id="cover" className="relative" aria-labelledby="cover-title">
      {/* Mat + dot grid, fading in below the headline */}
      <div
        className="absolute inset-0"
        style={{ background: "var(--reader-mat)" }}
        aria-hidden
      />
      <div
        className="landing-dots absolute inset-0"
        style={{
          maskImage:
            "linear-gradient(180deg, transparent 30%, black 75%, black 100%)",
        }}
        aria-hidden
      />
      {/* White strip behind the lower half of the workspace mock */}
      <div
        className="absolute inset-x-0 bottom-0 h-44 sm:h-56"
        style={{ background: "var(--background)" }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-280 px-6 md:px-10">
        <div className="mx-auto max-w-210 pt-20 text-center sm:pt-24">
          <MonoLabel>Open source · MIT licensed · Free to use</MonoLabel>

          <h1 id="cover-title" className="landing-h1 mt-6">
            Explore the <span className="frontier">frontier.</span>
          </h1>

          <p className="landing-lede mx-auto mt-7 max-w-150 text-[18px]">
            A workspace for researchers. Discover what to read next, then read
            it alongside an AI assistant that knows the whole text.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-2.5">
            <a
              href={signupHref}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4.5 text-[13.5px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 active:translate-y-px"
            >
              Get started
              <ArrowRight className="size-[13px]" />
            </a>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-[18px] text-[13.5px] font-medium text-foreground transition-colors duration-150 hover:bg-muted"
            >
              <GithubMark className="size-[13px]" />
              View on GitHub
            </a>
          </div>

          <p className="mt-5 text-[12.5px] text-muted-foreground/80">
            Free usage every day · No key required to start · Self-host if you
            like
          </p>
        </div>

        <div className="relative mt-14 pb-16 sm:mt-16 sm:pb-20">
          <LandingWorkspace />
        </div>
      </div>
    </section>
  );
}
