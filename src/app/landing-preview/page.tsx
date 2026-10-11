import { notFound } from "next/navigation";
import { LandingPage } from "@/components/landing/landing-page";

/**
 * Dev-only route for previewing the marketing page on localhost, where the
 * apex host discrimination in app/page.tsx never serves it.
 */
export default function LandingPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <LandingPage preview />;
}
