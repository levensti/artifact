import "server-only";
import { NextResponse } from "next/server";
import { auth } from "./auth";
import { isAdminEmail } from "@/lib/admin";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Read the current session and return its user id, or throw 401. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new HttpError(401, "Unauthorized");
  return session.user.id;
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("API error:", error);
  const message = error instanceof Error ? error.message : "Internal error";
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Wrap a route handler with auth + error normalization. The handler receives
 * the authenticated userId; thrown HttpErrors become typed JSON responses.
 */
export function authedRoute<Args extends unknown[], R>(
  handler: (userId: string, ...args: Args) => Promise<R>,
): (...args: Args) => Promise<R | NextResponse> {
  return async (...args: Args) => {
    try {
      const userId = await requireUserId();
      return await handler(userId, ...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Read the session and return its user id, but only for an admin caller;
 * throws 401 if signed out, 403 if signed in without an allowlisted email.
 */
export async function requireAdminUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new HttpError(401, "Unauthorized");
  if (!isAdminEmail(session.user.email)) throw new HttpError(403, "Forbidden");
  return session.user.id;
}

/**
 * Like `authedRoute`, but restricted to admins (see `ADMIN_EMAILS`). Used to
 * gate prototype/owner-only features; the handler still receives the userId.
 */
export function adminRoute<Args extends unknown[], R>(
  handler: (userId: string, ...args: Args) => Promise<R>,
): (...args: Args) => Promise<R | NextResponse> {
  return async (...args: Args) => {
    try {
      const userId = await requireAdminUserId();
      return await handler(userId, ...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
