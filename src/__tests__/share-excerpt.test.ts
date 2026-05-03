import { describe, it, expect } from "vitest";
import { extractExcerpt } from "@/lib/share-excerpt";

describe("extractExcerpt", () => {
  it("returns short content unchanged", () => {
    expect(extractExcerpt("Hello world.", 100)).toBe("Hello world.");
  });

  it("strips markdown headers", () => {
    expect(extractExcerpt("# A heading\n\nBody text.", 100)).toBe(
      "A heading Body text.",
    );
  });

  it("unwraps wiki links to their slug or alias", () => {
    expect(extractExcerpt("See [[transformer]] for details.", 100)).toBe(
      "See transformer for details.",
    );
    expect(extractExcerpt("See [[transformer|the transformer]] paper.", 100)).toBe(
      "See the transformer paper.",
    );
  });

  it("flattens markdown links to their label", () => {
    expect(
      extractExcerpt("Check the [paper](https://arxiv.org/abs/1706.03762)!", 100),
    ).toBe("Check the paper!");
  });

  it("removes inline code and code fences", () => {
    expect(
      extractExcerpt("Use `npm test` to run.\n\n```\nlong block\n```", 100),
    ).toBe("Use to run.");
  });

  it("strips emphasis and blockquote markers", () => {
    expect(extractExcerpt("> *Important*: be careful.", 100)).toBe(
      "Important: be careful.",
    );
  });

  it("truncates at a word boundary with an ellipsis", () => {
    const long =
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron";
    const out = extractExcerpt(long, 30);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(31);
    // Should not slice mid-word — last char before ellipsis is a real letter.
    expect(/[a-z]…$/.test(out)).toBe(true);
  });

  it("falls back to mid-word cut when the last space is too far back", () => {
    // No spaces in last 60% of the cut → must hard-cut.
    const url = "a-very-long-singular-token-without-any-spaces-anywhere-here";
    const out = extractExcerpt(url, 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBe(21);
  });

  it("collapses runs of whitespace", () => {
    expect(extractExcerpt("Lots\n\n\n  of\t\twhitespace.", 100)).toBe(
      "Lots of whitespace.",
    );
  });
});
