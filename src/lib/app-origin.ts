/**
 * Origin of the app subdomain (e.g. `https://app.withartifact.com`).
 *
 * The landing page lives on the apex (`withartifact.com`); every CTA points
 * across to the app subdomain. In dev / preview where `APP_HOST` is unset we
 * return an empty string so links resolve to the current origin.
 */
export function getAppOrigin(): string {
  const host = process.env.APP_HOST?.trim();
  return host ? `https://${host}` : "";
}
