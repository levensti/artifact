import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { isApexHost } from "@/lib/host";

/**
 * Host-aware routing:
 *   • Apex (e.g. withartifact.com) — marketing only. The root `/` is
 *     rendered by `app/page.tsx`, which host-discriminates and shows the
 *     marketing surface. Authenticated visitors are bounced straight to
 *     the app. All other paths redirect to the app subdomain. There is
 *     no `/landing` route — direct hits to `/landing` 404 naturally on
 *     either host.
 *   • App subdomain (e.g. app.withartifact.com) — full app + auth flow.
 *   • Localhost / unknown hosts — treated as the app subdomain so dev and
 *     preview deploys work without env config.
 *
 * Env-driven so the same code runs everywhere:
 *   APEX_HOSTS  — comma-separated bare hostnames (no scheme/port)
 *   APP_HOST    — bare hostname of the app subdomain
 */
const APP_HOST = process.env.APP_HOST?.trim() || null;

export default auth((req) => {
  const { nextUrl } = req;
  const host = req.headers.get("host");

  // ── Apex: marketing landing only ──────────────────────────────
  if (isApexHost(host)) {
    // Already-authenticated visitors get sent straight to the app — the
    // landing page is for prospects, not for return visits.
    if (req.auth?.user && APP_HOST) {
      const target = new URL(
        nextUrl.pathname + nextUrl.search,
        `https://${APP_HOST}`,
      );
      return NextResponse.redirect(target, 308);
    }
    if (nextUrl.pathname === "/") {
      // Apex root → let app/page.tsx render the marketing surface.
      return NextResponse.next();
    }
    // Auth lives only on the app subdomain — bounce apex auth URLs across.
    // Falls through to next() if APP_HOST is unset (dev / preview).
    if (APP_HOST) {
      const target = new URL(
        nextUrl.pathname + nextUrl.search,
        `https://${APP_HOST}`,
      );
      return NextResponse.redirect(target, 308);
    }
    return NextResponse.next();
  }

  // ── App subdomain (and localhost / preview) ───────────────────
  const isAuthed = !!req.auth?.user;

  // Share landing pages and their public metadata routes need to load
  // for unauthenticated visitors — the whole point is that anyone with
  // the link can see the preview before deciding to sign up.
  const isPublicShareRoute =
    nextUrl.pathname.startsWith("/share/") ||
    /^\/api\/shares\/[^/]+\/preview\/?$/.test(nextUrl.pathname);

  const isOpen =
    nextUrl.pathname === "/signin" ||
    nextUrl.pathname === "/signup" ||
    nextUrl.pathname.startsWith("/api/auth/") ||
    isPublicShareRoute;
  if (isOpen) return;

  if (!isAuthed) {
    if (nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Bare landing → default to sign-up (new visitor pattern). Specific app
    // paths → sign-in (the visitor was reaching for a feature, probably
    // already has an account; their session likely just expired).
    if (nextUrl.pathname === "/") {
      return NextResponse.redirect(new URL("/signup", nextUrl.origin));
    }
    const url = new URL("/signin", nextUrl.origin);
    url.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals, static assets, and public
    // image endpoints. The OG/Twitter image routes (default + per-share)
    // must bypass auth middleware entirely: redirecting them traps unfurl
    // bots on /signin, and even setting auth cookies on the response is
    // enough for some bots (Apple/iMessage) to silently drop the preview.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|opengraph-image|twitter-image|share/[^/]+/og|.*\\.svg|.*\\.png).*)",
  ],
};
