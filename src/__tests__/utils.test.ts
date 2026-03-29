import { describe, it, expect } from "vitest";
import { extractArxivId, arxivPdfUrl } from "@/lib/utils";

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
