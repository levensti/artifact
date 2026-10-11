import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getAppOrigin } from "@/lib/app-origin";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingDiscover } from "@/components/landing/landing-discover";
import { LandingReview } from "@/components/landing/landing-review";
import { LandingShare } from "@/components/landing/landing-share";
import { LandingOpenSource } from "@/components/landing/landing-open-source";
import { LandingCta } from "@/components/landing/landing-cta";
import { LandingFooter } from "@/components/landing/landing-footer";
import { Reveal } from "@/components/landing/landing-reveal";

const GITHUB_URL =
  process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/levensti/artifact";

/**
 * Marketing landing page. Rendered at the apex root (`withartifact.com/`)
 * via host discrimination in `app/page.tsx`. Not a route on its own.
 *
 * Layout: one flat paper tone for the whole page, sections separated by
 * hairline rules. Color is reserved for the product mocks and the primary
 * action; the workspace miniature is the showpiece.
 *
 * The wrapping div is the page's own scroll container: the root <body>
 * is `overflow-hidden` so the PDF reader stays pinned to the viewport.
 */
export async function LandingPage({
  preview = false,
}: {
  /// Skip the authed-visitor redirect (dev preview route only).
  preview?: boolean;
} = {}) {
  const appOrigin = getAppOrigin();

  // Belt-and-braces: the proxy already bounces authed apex visitors to the
  // app subdomain, but in case anyone reaches this render path while authed
  // we still send them onward. If auth isn't configured (e.g. local dev
  // without secrets), `auth()` throws; fall through and render the page.
  let isAuthed = false;
  try {
    const session = await auth();
    isAuthed = !!session?.user;
  } catch {
    isAuthed = false;
  }
  if (isAuthed && !preview) {
    redirect(appOrigin ? `${appOrigin}/` : "/");
  }

  const signupHref = `${appOrigin}/signup`;

  return (
    <div
      id="landing-scroll"
      className="landing-root h-full overflow-y-auto text-foreground"
      style={{ background: "var(--reader-mat)" }}
    >
      <LandingNav
        signupHref={signupHref}
        signinHref={`${appOrigin}/signin`}
        githubUrl={GITHUB_URL}
      />
      <main>
        <Reveal scrollGate={false}>
          <LandingHero signupHref={signupHref} githubUrl={GITHUB_URL} />
        </Reveal>

        <Reveal>
          <LandingDiscover />
        </Reveal>

        <Reveal>
          <LandingReview />
        </Reveal>

        <Reveal>
          <LandingShare />
        </Reveal>

        <Reveal>
          <LandingOpenSource githubUrl={GITHUB_URL} />
        </Reveal>

        <LandingCta signupHref={signupHref} />

        <LandingFooter signupHref={signupHref} githubUrl={GITHUB_URL} />
      </main>
    </div>
  );
}
