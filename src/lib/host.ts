/**
 * Apex host detection — shared between the proxy and `app/page.tsx`, which
 * both need to know whether an incoming request is hitting the marketing
 * apex (e.g. `withartifact.com`) or the app subdomain.
 *
 * `APEX_HOSTS` is a comma-separated list of bare hostnames (no scheme/port).
 * Empty in dev / preview where no apex is wired up.
 */
const APEX_HOSTS = (process.env.APEX_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function isApexHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const bare = host.split(":")[0];
  return APEX_HOSTS.includes(bare);
}

export function getApexHost(): string | null {
  return APEX_HOSTS[0] ?? null;
}
