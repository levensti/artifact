import { LandingWorkspace } from "@/components/landing/landing-workspace";
import { LandingPaperField } from "@/components/landing/landing-paper-field";
import { GithubMark } from "@/components/landing/landing-icons";

export interface LandingHeroProps {
  signupHref: string;
  githubUrl: string;
}

/**
 * Cover: one line, set large and centred, rising out of a drifting field of
 * paper text (the product's own subject matter, with passages being marked
 * as you watch). The workspace miniature comes up underneath and settles
 * flat as the page scrolls. The load sequence is the page's one orchestrated
 * motion moment: field, headline, subhead, actions.
 */
export function LandingHero({ signupHref, githubUrl }: LandingHeroProps) {
  return (
    <section id="cover" aria-labelledby="cover-title" className="relative">
      <div className="landing-cover relative isolate flex flex-col items-center justify-center overflow-hidden px-6 text-center">
        <LandingPaperField />

        <div className="relative z-10 mx-auto max-w-[920px] pb-16">
          <h1
            id="cover-title"
            className="landing-display cover-in"
            style={{ animationDelay: "250ms" }}
          >
            Explore the frontier
          </h1>

          <p
            className="landing-lede cover-in mx-auto mt-6 max-w-130 text-[18px] leading-[1.55]"
            style={{ animationDelay: "450ms" }}
          >
            Pair with your personalized AI copilot to explore any arXiv paper,
            PDF, or web page and go deep. Open source (MIT-licensed) and free to
            use, thanks to generous support from sponsors.
          </p>

          <div
            className="cover-in mt-9 flex flex-wrap items-center justify-center gap-2.5"
            style={{ animationDelay: "600ms" }}
          >
            <a
              href={signupHref}
              className="inline-flex h-11 items-center rounded-md bg-foreground px-5 text-[14.5px] font-medium text-background transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Start reading
            </a>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-card px-5 text-[14.5px] font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <GithubMark className="size-4" />
              View on GitHub
            </a>
          </div>
        </div>
      </div>

      {/* The workspace comes up out of the paper field and settles flat as
          it scrolls into view. */}
      <div className="relative z-10 mx-auto -mt-24 max-w-[1120px] px-6 pb-20 sm:-mt-32 sm:pb-24 md:px-10">
        <div className="cover-rise">
          <LandingWorkspace />
        </div>
      </div>
    </section>
  );
}
