/**
 * A standalone Prisma client for the eval harnesses.
 *
 * The app's client (`src/server/db.ts`) starts with `import "server-only"`,
 * which throws the moment it's loaded in a plain Node/tsx process — so the eval
 * can't reuse it. This builds the same `PrismaPg`-adapter client from
 * `DATABASE_URL`, minus the server-only guard and the Next build-time lazy
 * proxy (a one-shot batch job needs neither). Remember to `$disconnect()` when
 * the run finishes so the process can exit.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export function createEvalPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — add it to .env (the same connection the app uses) " +
        "or pass --no-persist to run without writing results to the database.",
    );
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
