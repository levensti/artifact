import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getAppOrigin } from "@/lib/app-origin";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingSurfaces } from "@/components/landing/landing-surfaces";
import { LandingJournal } from "@/components/landing/landing-journal";
import { LandingShare } from "@/components/landing/landing-share";
import { LandingPrinciples } from "@/components/landing/landing-principles";
import { LandingCoda } from "@/components/landing/landing-coda";
import { LandingInvitation } from "@/components/landing/landing-invitation";
import { LandingFooter } from "@/components/landing/landing-footer";
import { Reveal } from "@/components/landing/landing-reveal";
import { CometDivider } from "@/components/landing/landing-comet-divider";

const GITHUB_URL =
  process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/levensti/artifact";

/**
 * Marketing landing page. Rendered at the apex root (`withartifact.com/`)
 * via host discrimination in `app/page.tsx`. Not a route on its own.
 *
 * Layout: a "folio" — a sheet of paper laid on the warm reader mat.
 * Sections share a two-column grid (`landing-spread`): a 200px marginalia
 * column (folio numbers, italic margin notes) and a body column. Hairline
 * rules separate sections.
 *
 * The wrapping div is the page's own scroll container: the root <body>
 * is `overflow-hidden` so the PDF reader stays pinned to the viewport.
 */
export async function LandingPage() {
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
  if (isAuthed) {
    redirect(appOrigin ? `${appOrigin}/` : "/");
  }

  const signupHref = `${appOrigin}/signup`;

  return (
    <div
      id="landing-scroll"
      className="landing-root h-full overflow-y-auto"
      style={{
        background: "var(--reader-mat)",
        color: "var(--foreground)",
      }}
    >
      <LandingNav signupHref={signupHref} />
      <main>
        <article className="landing-folio">
          <Reveal scrollGate={false}>
            <LandingHero signupHref={signupHref} githubUrl={GITHUB_URL} />
          </Reveal>

          <CometDivider topPx={64} bottomPx={56} />

          <Reveal>
            <LandingSurfaces />
          </Reveal>

          <CometDivider topPx={24} bottomPx={32} />

          <Reveal>
            <LandingJournal />
          </Reveal>

          <CometDivider topPx={32} bottomPx={32} />

          <Reveal>
            <LandingShare />
          </Reveal>

          <CometDivider topPx={32} bottomPx={40} />

          <Reveal>
            <LandingPrinciples />
          </Reveal>

          <Reveal>
            <LandingCoda githubUrl={GITHUB_URL} />
          </Reveal>

          <Reveal>
            <LandingInvitation signupHref={signupHref} />
          </Reveal>

          <LandingFooter signupHref={signupHref} githubUrl={GITHUB_URL} />
        </article>
      </main>
    </div>
  );
}
