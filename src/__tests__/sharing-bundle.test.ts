import { describe, it, expect } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  bundleFilename,
  validateBundle,
  type ReviewBundle,
  type WikiBundle,
} from "@/lib/client/sharing/bundle-format";

/* ── Fixtures ─────────────────────────────────────────────────── */

function makeReviewBundle(): ReviewBundle {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    type: "review",
    exportedAt: "2026-04-15T00:00:00.000Z",
    data: {
      review: {
        id: "rev-1",
        title: "Attention Is All You Need",
        arxivId: "1706.03762",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        pdfPath: null,
        sourceUrl: null,
      },
      messages: [
        {
          id: "m1",
          role: "user",
          content: "What's the core idea?",
          timestamp: "2024-01-01T00:00:01.000Z",
        },
      ],
      annotations: [],
      deepDives: [],
      prerequisites: null,
    },
  };
}

function makeWikiBundle(): WikiBundle {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    type: "wiki",
    exportedAt: "2026-04-15T00:00:00.000Z",
    data: {
      pages: [
        {
          id: "p1",
          slug: "transformer-architecture",
          title: "Transformer Architecture",
          content: "See also [[attention-mechanism]].",
          pageType: "session",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    },
  };
}

/* ── validateBundle ───────────────────────────────────────────── */

describe("validateBundle", () => {
  it("accepts a well-formed review bundle", () => {
    const result = validateBundle(makeReviewBundle());
    expect(result.ok).toBe(true);
    expect(result.bundle?.type).toBe("review");
    expect(result.issues).toEqual([]);
  });

  it("accepts a well-formed wiki bundle", () => {
    const result = validateBundle(makeWikiBundle());
    expect(result.ok).toBe(true);
    expect(result.bundle?.type).toBe("wiki");
  });

  it("rejects a non-object root", () => {
    const result = validateBundle("not an object");
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("expected object at root"))).toBe(
      true,
    );
  });

  it("rejects a bundle with the wrong schemaVersion", () => {
    const bundle = makeReviewBundle();
    const result = validateBundle({
      ...bundle,
      schemaVersion: 999,
    });
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => i.includes("schemaVersion")),
    ).toBe(true);
  });

  it("rejects a bundle with an unknown type", () => {
    const bundle = makeReviewBundle() as unknown as Record<string, unknown>;
    const result = validateBundle({ ...bundle, type: "unknown" });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("type"))).toBe(true);
  });

  it("rejects a review bundle missing required fields", () => {
    const bad = makeReviewBundle() as unknown as Record<string, unknown>;
    // Drop the review's title
    const data = { ...(bad.data as Record<string, unknown>) };
    data.review = { ...(data.review as Record<string, unknown>), title: 42 };
    const result = validateBundle({ ...bad, data });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("title"))).toBe(true);
  });

  it("rejects a review bundle with a non-array messages field", () => {
    const bad = makeReviewBundle() as unknown as Record<string, unknown>;
    const data = { ...(bad.data as Record<string, unknown>), messages: {} };
    const result = validateBundle({ ...bad, data });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("messages"))).toBe(true);
  });

  it("rejects a wiki bundle with an empty pages array", () => {
    const bad = makeWikiBundle() as unknown as Record<string, unknown>;
    const data = { ...(bad.data as Record<string, unknown>), pages: [] };
    const result = validateBundle({ ...bad, data });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("pages"))).toBe(true);
  });

  it("rejects a wiki page with an unknown pageType", () => {
    const bundle = makeWikiBundle();
    const bad = {
      ...bundle,
      data: {
        pages: [
          {
            ...bundle.data.pages[0],
            pageType: "nope",
          },
        ],
      },
    };
    const result = validateBundle(bad);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("pageType"))).toBe(true);
  });

  it("round-trips through JSON.stringify → parse → validate", () => {
    const bundle = makeReviewBundle();
    const text = JSON.stringify(bundle);
    const roundtripped = JSON.parse(text);
    const result = validateBundle(roundtripped);
    expect(result.ok).toBe(true);
    expect(result.bundle).toEqual(bundle);
  });
});

/* ── bundleFilename ───────────────────────────────────────────── */

describe("bundleFilename", () => {
  it("produces a slug-style filename for reviews", () => {
    expect(bundleFilename("review", "Attention Is All You Need")).toBe(
      "review-attention-is-all-you-need.json",
    );
  });

  it("produces a slug-style filename for wiki pages", () => {
    expect(bundleFilename("wiki", "Transformer Architecture")).toBe(
      "journal-transformer-architecture.json",
    );
  });

  it("falls back to a default slug when the title has no usable characters", () => {
    expect(bundleFilename("review", "!!!")).toBe("review-review.json");
    expect(bundleFilename("wiki", "—")).toBe("journal-journal-entry.json");
  });

  it("truncates long titles", () => {
    const title = "a".repeat(200);
    const name = bundleFilename("review", title);
    // `review-` prefix + up to 60 slug chars + `.json`
    expect(name.length).toBeLessThanOrEqual("review-".length + 60 + ".json".length);
  });
});
