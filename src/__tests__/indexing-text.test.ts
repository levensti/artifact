import { describe, it, expect } from "vitest";
import {
  pageAt,
  pageRange,
  parsePageMarkers,
  splitSentences,
} from "@/server/indexing/text";

const DOC = "[Page 1]\nFirst sentence. Second one here! Third? [Page 2]\nFourth on page two.";

describe("page markers", () => {
  it("parses markers with offsets", () => {
    const m = parsePageMarkers(DOC);
    expect(m.map((x) => x.page)).toEqual([1, 2]);
    expect(m[0].offset).toBe(0);
    expect(DOC.slice(m[1].offset, m[1].offset + 8)).toBe("[Page 2]");
  });
  it("maps offsets to pages", () => {
    const m = parsePageMarkers(DOC);
    expect(pageAt(m, 10)).toBe(1);
    expect(pageAt(m, DOC.length - 1)).toBe(2);
    expect(pageAt([], 5)).toBeNull();
  });
  it("returns a page's char range", () => {
    const m = parsePageMarkers(DOC);
    const r = pageRange(m, 2, DOC.length)!;
    expect(DOC.slice(r.start, r.end)).toContain("Fourth on page two");
    expect(pageRange(m, 9, DOC.length)).toBeNull();
  });
});

describe("splitSentences", () => {
  it("splits on terminal punctuation and strips markers", () => {
    const s = splitSentences(DOC);
    expect(s.map((x) => x.text)).toEqual([
      "First sentence.",
      "Second one here!",
      "Third?",
      "Fourth on page two.",
    ]);
    // Offsets point back into the original text.
    expect(DOC.slice(s[1].start, s[1].end)).toBe("Second one here!");
  });
  it("respects a sub-range", () => {
    const start = DOC.indexOf("Third");
    const s = splitSentences(DOC, start);
    expect(s[0].text).toBe("Third?");
  });
  it("hard-splits punctuation-free runs", () => {
    const run = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
    const s = splitSentences(run);
    expect(s.length).toBeGreaterThan(1);
    expect(Math.max(...s.map((x) => x.text.length))).toBeLessThanOrEqual(800);
  });
  it("does not split on decimals or lowercase continuations", () => {
    const s = splitSentences("Accuracy rose to 93.5 on the test set. we then stopped. Done.");
    expect(s.map((x) => x.text)).toEqual([
      "Accuracy rose to 93.5 on the test set. we then stopped.",
      "Done.",
    ]);
  });
});
