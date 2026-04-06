/** Shared types for arXiv search results (used by chat tools and search API). */

export interface ArxivSearchResult {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  publishedDate: string;
  categories: string[];
}
