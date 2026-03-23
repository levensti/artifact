import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function extractArxivId(url: string): string | null {
  // Matches arxiv.org/abs/XXXX.XXXXX or arxiv.org/pdf/XXXX.XXXXX
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
  return match ? match[1] : null;
}

export function arxivPdfUrl(idOrUrl: string): string {
  const id = extractArxivId(idOrUrl) ?? idOrUrl;
  return `https://arxiv.org/pdf/${id}`;
}

