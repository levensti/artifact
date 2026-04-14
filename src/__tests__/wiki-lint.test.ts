import { describe, it, expect } from "vitest";
import { lintPages } from "@/lib/wiki-lint";
import type { WikiPage } from "@/lib/wiki";

function page(partial: Partial<WikiPage>): WikiPage {
  const now = new Date().toISOString();
  return {
    id: partial.slug ?? "x",
    slug: partial.slug ?? "x",
    title: partial.title ?? partial.slug ?? "X",
    content: partial.content ?? "a ".repeat(200),
    pageType: partial.pageType ?? "concept",
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

describe("lintPages", () => {
  it("flags broken [[slug]] references", () => {
    const report = lintPages([
      page({
        slug: "transformer",
        content: "See also [[attention]] and [[nonexistent-thing]].",
      }),
      page({ slug: "attention" }),
    ]);
    expect(report.brokenRefs).toHaveLength(1);
    expect(report.brokenRefs[0]).toMatchObject({
      sourceSlug: "transformer",
      targetSlug: "nonexistent-thing",
    });
  });

  it("marks non-paper pages with zero backlinks as orphans", () => {
    const report = lintPages([
      page({ slug: "orphan-method", pageType: "method" }),
      page({
        slug: "linked-method",
        pageType: "method",
        content: "Referenced from [[another]].",
      }),
      page({ slug: "another", content: "Uses [[linked-method]]." }),
    ]);
    const orphanSlugs = report.orphans.map((o) => o.slug).sort();
    expect(orphanSlugs).toContain("orphan-method");
    expect(orphanSlugs).not.toContain("linked-method");
  });

  it("excludes paper pages from orphan list", () => {
    const report = lintPages([page({ slug: "some-paper", pageType: "paper" })]);
    expect(report.orphans).toHaveLength(0);
  });

  it("detects stale pages older than 30 days", () => {
    const oldIso = new Date(Date.now() - 45 * 86400 * 1000).toISOString();
    const report = lintPages([
      page({ slug: "fresh" }),
      page({ slug: "old", updatedAt: oldIso }),
    ]);
    expect(report.stale.map((s) => s.slug)).toEqual(["old"]);
    expect(report.stale[0].ageDays).toBeGreaterThanOrEqual(45);
  });

  it("detects stub pages under the word count threshold", () => {
    const report = lintPages([
      page({ slug: "tiny", content: "Just three words here." }),
      page({ slug: "normal", content: "word ".repeat(200) }),
    ]);
    expect(report.stubs.map((s) => s.slug)).toContain("tiny");
    expect(report.stubs.map((s) => s.slug)).not.toContain("normal");
  });

  it("ignores index and log pages entirely", () => {
    const report = lintPages([
      page({ slug: "index", pageType: "index", content: "tiny" }),
      page({ slug: "log", pageType: "log", content: "tiny" }),
    ]);
    expect(report.totalPages).toBe(0);
    expect(report.stubs).toHaveLength(0);
  });
});
