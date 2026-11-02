import { describe, it, expect } from "vitest";
import { extractArxivId, arxivPdfUrl } from "@/lib/utils";
import { arxivIdFromUrl } from "@/lib/picks-parser";

describe("extractArxivId", () => {
  it("extracts id from abs URL", () => {
    expect(extractArxivId("https://arxiv.org/abs/2301.07041")).toBe("2301.07041");
  });

  it("extracts id from pdf URL", () => {
    expect(extractArxivId("https://arxiv.org/pdf/2301.07041")).toBe("2301.07041");
  });

  it("strips version suffix", () => {
    expect(extractArxivId("https://arxiv.org/abs/2301.07041v3")).toBe("2301.07041");
  });

  it("returns null for non-arxiv URLs", () => {
    expect(extractArxivId("https://example.com/paper")).toBeNull();
  });

  it("extracts id from HTML and versioned PDF URLs", () => {
    expect(extractArxivId("https://arxiv.org/html/2301.07041v2")).toBe("2301.07041");
    expect(extractArxivId("https://www.arxiv.org/pdf/2301.07041v1.pdf")).toBe("2301.07041");
  });

  it("returns null for empty string", () => {
    expect(extractArxivId("")).toBeNull();
  });
});

describe("arxivPdfUrl", () => {
  it("converts abs URL to pdf URL", () => {
    expect(arxivPdfUrl("https://arxiv.org/abs/2301.07041")).toBe(
      "https://arxiv.org/pdf/2301.07041",
    );
  });

  it("handles raw id", () => {
    expect(arxivPdfUrl("2301.07041")).toBe("https://arxiv.org/pdf/2301.07041");
  });
});

describe("arxivIdFromUrl", () => {
  it("recognizes the same arXiv links as starting a review", () => {
    expect(arxivIdFromUrl("https://arxiv.org/abs/2301.07041")).toBe("2301.07041");
    expect(arxivIdFromUrl("https://arxiv.org/pdf/2301.07041v3")).toBe("2301.07041");
    expect(arxivIdFromUrl("https://arxiv.org/html/2301.07041")).toBe("2301.07041");
    expect(arxivIdFromUrl("https://example.com/2301.07041")).toBeNull();
  });
});
