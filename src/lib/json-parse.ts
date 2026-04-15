/**
 * Lenient JSON extraction helpers for LLM responses.
 *
 * LLMs frequently wrap JSON in ```fenced``` blocks or sprinkle stray
 * prose around it. These helpers strip fences and, failing that, walk
 * the string to extract a balanced JSON object or array substring. If
 * every attempt fails, return the caller's fallback so silent ambient
 * pipelines never throw on malformed output.
 */

/** Remove surrounding ``` or ```json fences, if present. */
export function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/m, "")
    .trim();
}

/** Find the first balanced JSON object or array substring in `s`. */
export function extractJsonSubstring(s: string): string {
  const startObj = s.indexOf("{");
  const startArr = s.indexOf("[");
  let start = -1;
  if (startObj === -1) start = startArr;
  else if (startArr === -1) start = startObj;
  else start = Math.min(startObj, startArr);
  if (start === -1) return s;

  const openChar = s[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === openChar) depth++;
    else if (s[i] === closeChar) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s;
}

/** Parse a raw LLM string as JSON, falling back to `fallback` on failure. */
export function parseJson<T>(raw: string, fallback: T): T {
  const cleaned = stripCodeFences(raw);
  const candidates = [cleaned, extractJsonSubstring(cleaned)];
  for (const blob of candidates) {
    try {
      return JSON.parse(blob) as T;
    } catch {
      /* try next */
    }
  }
  return fallback;
}
