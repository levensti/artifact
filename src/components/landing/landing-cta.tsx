import { ArrowRight } from "@/components/landing/landing-icons";

export interface LandingCtaProps {
  signupHref: string;
}

/**
 * Closing block: one line, one button, set inside a hairline frame on the
 * same paper as the rest of the page.
 */
export function LandingCta({ signupHref }: LandingCtaProps) {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-[1120px] px-6 py-20 sm:py-24 md:px-10">
        <div className="flex flex-col items-start gap-6 rounded-lg border border-border bg-card px-8 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <div>
            <h2 className="landing-h2">Start reading.</h2>
            <p className="landing-lede mt-2">
              Free every day. MIT licensed. Self-host it if you prefer.
            </p>
          </div>
          <a
            href={signupHref}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-foreground px-4 text-[14px] font-medium text-background transition-opacity duration-150 hover:opacity-85"
          >
            Get started
            <ArrowRight className="size-[13px]" />
          </a>
        </div>
      </div>
    </section>
  );
}
