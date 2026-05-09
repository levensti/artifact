export interface LandingInvitationProps {
  signupHref: string;
}

export function LandingInvitation({ signupHref }: LandingInvitationProps) {
  return (
    <section className="pt-10 pb-12">
      <div className="landing-spread">
        <aside className="landing-marg" />
        <div>
          <p
            className="m-0 max-w-135 text-[22px] leading-[1.45]"
            style={{
              fontFamily: "var(--font-reading)",
              letterSpacing: "-0.012em",
              color: "var(--foreground)",
              textWrap: "balance",
            }}
          >
            Study anything. Capture what you learn. Push the frontier.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href={signupHref}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4.5 text-[13.5px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 active:translate-y-px"
            >
              Get started
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-[13px]"
                aria-hidden
              >
                <path d="M3 8h10" />
                <path d="M9 4l4 4-4 4" />
              </svg>
            </a>
            <span className="text-[13px] text-muted-foreground">
              Free, no paid tier · MIT licensed · Bring your own keys
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
