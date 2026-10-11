import { describe, it, expect } from "vitest";
import { buildPaperBlock } from "@/app/api/chat/paper-block";
import { formatRetrievedBlock } from "@/server/retrieval";
describe("buildPaperBlock", () => {
  it("returns null with nothing", () => {
    expect(buildPaperBlock(undefined)).toBeNull();
    expect(buildPaperBlock({})).toBeNull();
  });
  it("full text mode injects the text verbatim", () => {
    const b = buildPaperBlock({ text: "hello world" })!;
    expect(b).toBe("<paper>\nhello world\n</paper>");
  });
  it("retrieval mode carries title, ToC, passages, and the citation rule", () => {
    const b = buildPaperBlock({
      retrieved: "## §1 Intro\n(p. 1) passage",
      title: "A Paper",
      tableOfContents: "§1 Intro (p. 1)\n  §1.1 Sub (p. 2)",
    })!;
    expect(b).toContain("<title>A Paper</title>");
    expect(b).toContain("<table_of_contents>\n§1 Intro (p. 1)\n  §1.1 Sub (p. 2)\n</table_of_contents>");
    expect(b).toContain("<retrieved_passages>\n## §1 Intro");
    expect(b).toContain("`search_paper`");
    expect(b).toContain("Never invent a section number");
  });
  it("retrieval mode with no hits says so", () => {
    const b = buildPaperBlock({ retrieved: null })!;
    expect(b).toContain("(no passages matched this question)");
    expect(b).not.toContain("<table_of_contents>");
  });
  it("partial mode appends the note", () => {
    const b = buildPaperBlock({ text: "start", note: "still indexing" })!;
    expect(b).toContain("start");
    expect(b).toContain("<note>still indexing</note>");
  });
});

describe("formatRetrievedBlock", () => {
  it("groups by section in document order with page ranges and gap markers", () => {
    const out = formatRetrievedBlock([
      { ordinal: 2, text: "two", startPage: 3, endPage: 3, sectionTitle: "Intro", sectionLabel: "1" },
      { ordinal: 3, text: "three", startPage: 3, endPage: 4, sectionTitle: "Intro", sectionLabel: "1" },
      { ordinal: 9, text: "nine", startPage: 12, endPage: 12, sectionTitle: "Intro", sectionLabel: "1" },
      { ordinal: 20, text: "twenty", startPage: null, endPage: null, sectionTitle: null, sectionLabel: null },
    ]);
    expect(out).toBe(
      [
        "## §1 Intro",
        "(p. 3) two",
        "(pp. 3–4) three",
        "",
        "[…]",
        "(p. 12) nine",
        "",
        "## (unsectioned)",
        "twenty",
      ].join("\n"),
    );
  });
});
