import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Artifact — AI-paired workspace for researchers",
  description:
    "Read papers deeply, journal your learnings automatically, and never lose a thread. Open source. Bring your own keys.",
};

export default async function LandingPage() {
  const appOrigin = getAppOrigin();
  // The proxy is the source of truth for auth-aware host routing — apex
  // hits from authed users are bounced to the app, and direct hits on
  // `/landing` from either host are redirected away. This guard is a
  // defensive backup so that if the proxy is ever bypassed (or the route
  // is reached through some other means) authed users still don't see the
  // marketing page. If auth isn't configured (e.g. local dev without
  // secrets), `auth()` throws — fall through and render the page.
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
    <>
      <LandingNav signupHref={signupHref} githubUrl={GITHUB_URL} />
      <main>
        <LandingHero signupHref={signupHref} githubUrl={GITHUB_URL} />
        <LandingMarquee />
        <LandingPillars />
      </main>
      <LandingFooter githubUrl={GITHUB_URL} />
    </>
  );
}
