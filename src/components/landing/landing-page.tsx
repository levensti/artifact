import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getAppOrigin } from "@/lib/app-origin";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingMarquee } from "@/components/landing/landing-marquee";
import { LandingPillars } from "@/components/landing/landing-pillars";
import { LandingFooter } from "@/components/landing/landing-footer";

const GITHUB_URL =
  process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com/levensti/artifact";

/**
 * Marketing landing page. Rendered at the apex root (`withartifact.com/`)
 * via host discrimination in `app/page.tsx`. Not a route on its own — there
 * is no `/landing` URL on either host.
 *
 * The wrapping div is the page's own scroll container: the root <body> is
 * `overflow-hidden` so the PDF reader stays pinned to the viewport.
 */
export async function LandingPage() {
  const appOrigin = getAppOrigin();

  // Belt-and-braces: the proxy already bounces authed apex visitors to the
  // app subdomain, but in case anyone reaches this render path while authed
  // we still send them onward. If auth isn't configured (e.g. local dev
  // without secrets), `auth()` throws — fall through and render the page.
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
      className="h-full overflow-y-auto bg-background text-foreground"
    >
      <LandingNav signupHref={signupHref} githubUrl={GITHUB_URL} />
      <main>
        <LandingHero signupHref={signupHref} githubUrl={GITHUB_URL} />
        <LandingMarquee />
        <LandingPillars />
      </main>
      <LandingFooter githubUrl={GITHUB_URL} />
    </div>
  );
}
