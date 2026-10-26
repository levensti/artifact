
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BASE_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
} as const;

/** Self-identifying User-Agent for hosts that require declared automated
 *  traffic (SEC EDGAR's fair-access policy, for one): "Name contact". */
export function declaredUserAgent(contactEmail: string | null): string {
  return contactEmail ? `Artifact ${contactEmail}` : "Artifact withartifact.com";
}

/**
 * Fetch a page, trying a browser-style User-Agent first (what most sites
 * accept), then retrying once with a self-identifying UA if the site answers
 * 403. Some hosts reject undeclared automated traffic and require a
 * User-Agent of the form "Company Name contact@example.com".
 */
export async function fetchPage(
  url: string,
  contactEmail: string | null,
  timeoutMs = 25_000,
): Promise<Response> {
  const attempt = (userAgent: string) =>
    fetch(url, {
      headers: { ...BASE_HEADERS, "User-Agent": userAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });

  const first = await attempt(BROWSER_USER_AGENT);
  if (first.status !== 403) return first;
  return attempt(declaredUserAgent(contactEmail));
}

/**
 * Fetch a sub-resource (stylesheet, font, image) the way a browser loading
 * `referer` would, with the same 403 retry as pages.
 */
export async function fetchAsset(
  url: string,
  referer: string | null,
  contactEmail: string | null,
  timeoutMs = 15_000,
): Promise<Response> {
  const attempt = (userAgent: string) =>
    fetch(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "*/*",
        ...(referer ? { Referer: referer } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  const first = await attempt(BROWSER_USER_AGENT);
  if (first.status !== 403) return first;
  return attempt(declaredUserAgent(contactEmail));
}
