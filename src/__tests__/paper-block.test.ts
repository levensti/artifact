import { describe, it, expect } from "vitest";
import { buildPaperBlock } from "@/app/api/chat/paper-block";
import { formatRetrievedBlock, parsePlannedQueries } from "@/server/retrieval";
describe("buildPaperBlock", () => {
  it("returns null with no document", () => {
    expect(buildPaperBlock(undefined)).toBeNull();
  });
  it("carries title, ToC, passages, and the citation rule", () => {
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
  it("says so when nothing was retrieved", () => {
    const b = buildPaperBlock({ retrieved: null })!;
    expect(b).toContain("(no passages were retrieved for this message)");
    expect(b).not.toContain("<table_of_contents>");
  });
});

describe("parsePlannedQueries", () => {
  it("reads, trims, dedupes, and caps the planner's queries", () => {
    expect(
      parsePlannedQueries(
        '{"queries": [" problem and motivation ", "core method", "core method", 3, "", "a", "b", "c", "d"]}',
      ),
    ).toEqual(["problem and motivation", "core method", "a", "b", "c", "d"]);
  });
  it("accepts an empty plan and tolerates prose or fences around the JSON", () => {
    expect(parsePlannedQueries('{"queries": []}')).toEqual([]);
    expect(parsePlannedQueries('```json\n{"queries": ["loss"]}\n```')).toEqual(["loss"]);
  });
  it("rejects output that isn't a plan", () => {
    expect(parsePlannedQueries(undefined)).toBeNull();
    expect(parsePlannedQueries("loss function")).toBeNull();
    expect(parsePlannedQueries('{"query": "loss"}')).toBeNull();
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
