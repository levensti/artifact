import { ArrowRight } from "@/components/landing/landing-icons";

export interface LandingCtaProps {
  signupHref: string;
}

/**
 * Closing ink band — the brand line, once, big, and one button.
 */
export function LandingCta({ signupHref }: LandingCtaProps) {
  return (
    <section className="landing-ink relative overflow-hidden">
      <div
        className="landing-dots-inverse absolute inset-0"
        style={{
          maskImage:
            "linear-gradient(180deg, transparent 0%, transparent 40%, black 100%)",
        }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-[1120px] px-6 py-24 text-center sm:py-28 md:px-10">
        <h2
          className="landing-h2 mx-auto max-w-[680px]"
          style={{
            color: "var(--primary-foreground)",
            fontSize: "clamp(36px, 5vw, 54px)",
          }}
        >
          Explore the frontier.{" "}
          <span
            style={{
              fontFamily: "var(--font-reading)",
              fontStyle: "italic",
              fontWeight: 500,
              color:
                "color-mix(in srgb, var(--primary-foreground) 75%, transparent)",
            }}
          >
            Capture what you learn.
          </span>
        </h2>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a
            href={signupHref}
            className="inline-flex h-11 items-center gap-2 rounded-md px-5 text-[14px] font-medium transition-transform duration-150 hover:opacity-90 active:translate-y-px"
            style={{
              background: "var(--primary-foreground)",
              color: "var(--primary)",
            }}
          >
            Get started
            <ArrowRight className="size-[13px]" />
          </a>
        </div>

        <p
          className="mt-5 text-[12.5px]"
          style={{
            color:
              "color-mix(in srgb, var(--primary-foreground) 60%, transparent)",
          }}
        >
          Free usage every day · No key required to start · MIT licensed
        </p>
      </div>
    </section>
  );
}
