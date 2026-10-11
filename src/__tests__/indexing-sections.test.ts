import { describe, it, expect } from "vitest";
import { detectSections, leafRanges } from "@/server/indexing/sections";

function page(n: number, body: string) {
  return `[Page ${n}]\n${body}`;
}

describe("detectSections from outline", () => {
  const text = [
    page(1, "Title of the Book. Some preface text."),
    page(2, "1 Introduction Why this matters. More intro."),
    page(3, "1.1 Background The field began. 1.2 Scope We limit ourselves."),
    page(4, "2 Methods We did things."),
  ].join("\n\n");
  const outline = [
    { title: "1 Introduction", page: 2, depth: 0 },
    { title: "1.1 Background", page: 3, depth: 1 },
    { title: "1.2 Scope", page: 3, depth: 1 },
    { title: "2 Methods", page: 4, depth: 0 },
  ];

  it("builds a tree with labels, offsets refined to the heading, and page ranges", () => {
    const s = detectSections(text, outline);
    expect(s.map((x) => x.title)).toEqual(["Introduction", "Background", "Scope", "Methods"]);
    expect(s.map((x) => x.label)).toEqual(["1", "1.1", "1.2", "2"]);
    expect(s.map((x) => x.parentIndex)).toEqual([null, 0, 0, null]);
    expect(s.map((x) => x.depth)).toEqual([0, 1, 1, 0]);
    // "1.2 Scope" starts mid-page, at the heading itself, not at the page start.
    expect(text.slice(s[2].charStart, s[2].charStart + 9)).toBe("1.2 Scope");
    expect(s[0].startPage).toBe(2);
    expect(s[0].endPage).toBe(3); // spans its children
    expect(s[3].endPage).toBe(4);
  });

  it("leaf ranges exclude children's text and keep front matter unsectioned", () => {
    const s = detectSections(text, outline);
    const ranges = leafRanges(text, s);
    expect(ranges[0].sectionIndex).toBeNull();
    expect(ranges[0].charStart).toBe(0);
    const intro = ranges.find((r) => r.sectionIndex === 0)!;
    expect(text.slice(intro.charStart, intro.charEnd)).not.toContain("1.1 Background");
    expect(text.slice(intro.charStart, intro.charEnd)).toContain("Why this matters");
  });
});

describe("detectSections from numbered headings", () => {
  it("accepts a plausible sequence and rejects stray numbers", () => {
    const text =
      "[Page 1]\nAbstract blah. 1 Introduction We study things. Table 3 Results are shown. " +
      "2 Related Work Prior art exists. 2.1 Early Methods Old. 2.2 Recent Methods New. " +
      "3 Approach We propose. 7 Days later nothing. A Appendix Proofs here.";
    const s = detectSections(text);
    expect(s.map((x) => x.label)).toEqual(["1", "2", "2.1", "2.2", "3", "A"]);
    expect(s.map((x) => x.parentIndex)).toEqual([null, null, 1, 1, null, null]);
    expect(s.find((x) => x.title.startsWith("Results"))).toBeUndefined();
  });

  it("returns no sections for structureless text", () => {
    expect(detectSections("[Page 1]\nJust some prose with 5 numbers and 12 more.")).toEqual([]);
    expect(leafRanges("abc", [])).toEqual([{ sectionIndex: null, charStart: 0, charEnd: 3 }]);
  });
});

describe("labels", () => {
  it("parses printed numbers but not years or articles", async () => {
    const { splitLabel } = await import("@/server/indexing/sections");
    expect(splitLabel("3.1.4 Fine-Tuning")).toEqual({ label: "3.1.4", rest: "Fine-Tuning" });
    expect(splitLabel("A Tiny History of RLHF").label).toBeNull();
    expect(splitLabel("2019 to 2022: RL from Human Preferences").label).toBeNull();
    expect(splitLabel("A. Proofs")).toEqual({ label: "A", rest: "Proofs" });
    expect(splitLabel("Appendix B Extra Results")).toEqual({ label: "B", rest: "Extra Results" });
    expect(splitLabel("B.2 More").label).toBe("B.2");
  });

  it("derives positional labels from an unnumbered outline when the printed ToC confirms them", () => {
    const text =
      "[Page 1]\nContents 1 Introduction 3 1.1 Three Steps 3 1.2 Scope 4 2 History 5 " +
      "[Page 3]\nIntroduction Body one. Three Steps Body two. " +
      "[Page 4]\nScope Body three. [Page 5]\nHistory Body four.";
    const outline = [
      { title: "Introduction", page: 3, depth: 0 },
      { title: "Three Steps", page: 3, depth: 1 },
      { title: "Scope", page: 4, depth: 1 },
      { title: "History", page: 5, depth: 0 },
    ];
    const s = detectSections(text, outline);
    expect(s.map((x) => x.label)).toEqual(["1", "1.1", "1.2", "2"]);
  });

  it("leaves labels empty when the text does not confirm positional numbering", () => {
    const text =
      "[Page 1]\nPreface stuff. [Page 2]\nIntroduction Body one. Three Steps Body two. " +
      "[Page 3]\nScope Body three. [Page 4]\nHistory Body four.";
    const outline = [
      { title: "Introduction", page: 2, depth: 0 },
      { title: "Three Steps", page: 2, depth: 1 },
      { title: "Scope", page: 3, depth: 1 },
      { title: "History", page: 4, depth: 0 },
    ];
    const s = detectSections(text, outline);
    expect(s.every((x) => x.label === null)).toBe(true);
  });
});
