/**
 * Only fetch public http(s) URLs on the user's behalf. Blocks the obvious
 * server-side request forgery targets: loopback, link-local, private ranges,
 * and the cloud metadata address.
 */
export function isPublicHttpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "169.254.169.254"
  ) {
    return null;
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return null;
    }
  }
  if (host.includes(":")) {
    // IPv6 literal: allow only global unicast.
    if (/^(fc|fd|fe[89ab])/i.test(host) || host.startsWith("::")) return null;
  }
  return url;
}
