import { auth } from "@/server/auth";

export default auth((req) => {
  const { nextUrl } = req;
  const isAuthed = !!req.auth?.user;

  // /signin and /api/auth/* are open. Everything else requires a session.
  const isOpen =
    nextUrl.pathname === "/signin" ||
    nextUrl.pathname.startsWith("/api/auth/");
  if (isOpen) return;

  if (!isAuthed) {
    if (nextUrl.pathname.startsWith("/api/")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL("/signin", nextUrl.origin);
    url.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return Response.redirect(url);
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.svg|.*\\.png).*)",
  ],
};
