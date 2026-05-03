import type { Metadata } from "next";
import { headers } from "next/headers";
import HomeClient from "./home-client";
import { LandingPage } from "@/components/landing/landing-page";
import { isApexHost } from "@/lib/host";

/**
 * Root route. Host-discriminated:
 *   • Apex (e.g. `withartifact.com`) → marketing landing page.
 *   • App subdomain (e.g. `app.withartifact.com`) and dev/preview hosts
 *     → the dashboard. The proxy already redirects unauthed visitors away
 *     from the app subdomain root to `/signup`, so by the time we render
 *     `<HomeClient />` the user is authenticated.
 *
 * There is no `/landing` route — that path 404s naturally on every host.
 */
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  if (isApexHost(h.get("host"))) {
    return {
      title: "Artifact — AI-paired workspace for researchers",
      description:
        "Read papers deeply, journal your learnings automatically, and never lose a thread. Open source. Bring your own keys.",
    };
  }
  return { title: "Artifact" };
}

export default async function RootPage() {
  const h = await headers();
  if (isApexHost(h.get("host"))) {
    return <LandingPage />;
  }
  return <HomeClient />;
}
