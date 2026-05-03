import { NextResponse } from "next/server";
import { auth } from "@/server/auth";

/**
 * Host-aware routing:
 *   • Apex (e.g. withartifact.com) — public landing only. `/` is rewritten
 *     to `/landing`; everything else is redirected to the app subdomain.
 *   • App subdomain (e.g. app.withartifact.com) — full app + auth flow.
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

  // ── Apex: public sign-in / sign-up surface only ───────────────
  if (isApexHost(host)) {
    if (nextUrl.pathname === "/") {
      // New users hit the apex first — default them into the sign-up flow.
      const url = nextUrl.clone();
      url.pathname = "/signup";
      return NextResponse.rewrite(url);
    }
    if (nextUrl.pathname === "/signin" || nextUrl.pathname === "/signup") {
      return; // serve the page on apex directly
    }
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

  const isOpen =
    nextUrl.pathname === "/signin" ||
    nextUrl.pathname === "/signup" ||
    nextUrl.pathname.startsWith("/api/auth/");
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
