import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const BREAKPOINTS = {
  NARROW: "(max-width: 1023px)",
  COMPACT: "(max-width: 1279px)",
} as const;

/** The arXiv id in an arXiv abstract, PDF, or HTML link (version
 *  dropped), or null for any other URL. */
export function extractArxivId(url: string): string | null {
  const match = url.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d+\.\d+)(?:v\d+)?/i);
  return match ? match[1] : null;
}

export function arxivPdfUrl(idOrUrl: string): string {
  const id = extractArxivId(idOrUrl) ?? idOrUrl;
  return `https://arxiv.org/pdf/${id}`;
}
