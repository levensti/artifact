import "server-only";
import { NextResponse } from "next/server";
import { auth } from "./auth";

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
