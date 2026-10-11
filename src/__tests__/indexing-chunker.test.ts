import { describe, it, expect } from "vitest";
import { cosine, percentile, semanticChunk } from "@/server/indexing/chunker";

/**
 * Fake embedder: a sentence's vector is its topic one-hot (topic = the
 * letter prefix "A"/"B"/"C"), so consecutive windows on the same topic are
 * identical and a topic switch produces a distance spike.
 */
const fakeEmbed = async (texts: string[]) =>
  texts.map((t) => {
    const v = [0, 0, 0];
    for (const topic of ["A", "B", "C"]) {
      v["ABC".indexOf(topic)] += (t.match(new RegExp(`\\b${topic}\\d+`, "g")) ?? []).length;
    }
    return v;
  });

function sentences(topic: string, n: number, from = 0) {
  return Array.from({ length: n }, (_, i) => `${topic}${from + i} is a sentence about topic ${topic}.`).join(" ");
}

describe("semanticChunk", () => {
  it("cuts at the topic shift and keeps offsets", async () => {
    const text = `${sentences("A", 6)} ${sentences("B", 6)}`;
    const chunks = await semanticChunk(text, 0, text.length, fakeEmbed, {
      minTokens: 1,
      maxTokens: 10_000,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("A5");
    expect(chunks[0].text).not.toContain("B0");
    expect(chunks[1].text.startsWith("B0")).toBe(true);
    expect(text.slice(chunks[1].charStart, chunks[1].charEnd)).toBe(chunks[1].text);
  });

  it("splits oversized groups and merges undersized ones", async () => {
    const text = sentences("A", 40); // one topic, ~10 tokens/sentence
    const chunks = await semanticChunk(text, 0, text.length, fakeEmbed, {
      maxTokens: 60,
      minTokens: 20,
    });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(60);
    // No chunk below the floor except possibly where merging would overflow.
    expect(chunks.filter((c) => c.tokenCount < 20)).toHaveLength(0);
    // Coverage: chunks tile the text in order.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeGreaterThan(chunks[i - 1].charEnd - 1);
    }
  });

  it("handles tiny inputs without embedding", async () => {
    let called = false;
    const chunks = await semanticChunk("One. Two.", 0, 9, async (t) => {
      called = true;
      return fakeEmbed(t);
    });
    expect(called).toBe(false);
    expect(chunks).toHaveLength(1);
    expect(await semanticChunk("", 0, 0, fakeEmbed)).toEqual([]);
  });
});

describe("math helpers", () => {
  it("cosine", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
  it("percentile interpolates", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([], 90)).toBe(Infinity);
  });
});
