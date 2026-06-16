/**
 * The single workspace owner who can see and load the Evals dashboard. Used
 * client-side to gate the nav item's visibility and server-side (the real
 * enforcement) to gate the eval API routes. Not a secret — it's just an email,
 * and the server check is what actually protects the data.
 */
export const ADMIN_EMAILS = [
  "levensti+test@gmail.com",
  "levensti@gmail.com",
  "tobyzliang@gmail.com",
];

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}
