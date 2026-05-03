import { NextResponse } from "next/server";
import { auth } from "@/server/auth";

/**
 * Host-aware routing:
 *   • Apex (e.g. withartifact.com) — marketing only. `/` is rewritten to
 *     the internal `/landing` route (URL stays `/`). Direct access to
 *     `/landing` is bounced back to `/` so the marketing surface only ever
 *     exists at the apex root. All other paths redirect to the app
 *     subdomain. Authenticated visitors are bounced straight to the app.
 *   • App subdomain (e.g. app.withartifact.com) — full app + auth flow.
 *     Marketing has no presence here: `/landing` redirects to the apex
 *     and is not in the open-route allowlist.
 *   • Localhost / unknown hosts — treated as the app subdomain so dev and
 *     preview deploys work without env config.
 *
 * Env-driven so the same code runs everywhere:
 *   APEX_HOSTS  — comma-separated bare hostnames (no scheme/port)
 *   APP_HOST    — bare hostname of the app subdomain
 */
const APEX_HOSTS = (process.env.APEX_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const APP_HOST = process.env.APP_HOST?.trim() || null;

function isApexHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const bare = host.split(":")[0];
  return APEX_HOSTS.includes(bare);
}

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
    // /landing is an internal render target only — never a public URL.
    // If someone types it on the apex, send them to the marketing root.
    if (nextUrl.pathname === "/landing") {
      const url = nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url, 308);
    }
    if (nextUrl.pathname === "/") {
      // Apex root → marketing landing page (rewrite — URL stays `/`).
      const url = nextUrl.clone();
      url.pathname = "/landing";
      return NextResponse.rewrite(url);
    }
    // Auth lives only on the app subdomain — bounce apex auth URLs across.
    // Falls through to the generic apex→app redirect below if APP_HOST is unset.
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

  // Marketing has no presence on the app host. Bounce any direct hit
  // on /landing to the apex marketing root (or to /signup in dev where
  // no apex is configured, since unauthed visitors belong there anyway).
  if (nextUrl.pathname === "/landing") {
    const apex = APEX_HOSTS[0];
    if (apex) {
      return NextResponse.redirect(new URL("/", `https://${apex}`), 308);
    }
    return NextResponse.redirect(new URL("/signup", nextUrl.origin), 308);
  }

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
    // Run on everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.svg|.*\\.png).*)",
  ],
};
