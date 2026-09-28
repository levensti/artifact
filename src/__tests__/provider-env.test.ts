import { describe, it, expect, afterEach } from "vitest";
import {
  resolveFireworksKey,
  platformFireworksAvailable,
} from "@/server/provider-env";

function clearEnv() {
  delete process.env.FIREWORKS_API_KEY;
}

afterEach(clearEnv);

describe("resolveFireworksKey", () => {
  it("uses the caller's inline key when present (trimmed)", () => {
    process.env.FIREWORKS_API_KEY = "platform-key";
    expect(resolveFireworksKey("  user-key  ")).toBe("user-key");
  });

  it("falls back to the platform env key when no inline key", () => {
    process.env.FIREWORKS_API_KEY = "  fw-platform  ";
    expect(resolveFireworksKey("")).toBe("fw-platform");
    expect(resolveFireworksKey(undefined)).toBe("fw-platform");
    expect(resolveFireworksKey("   ")).toBe("fw-platform");
  });

  it("returns null when both inline and env are empty", () => {
    clearEnv();
    expect(resolveFireworksKey("")).toBeNull();
    expect(resolveFireworksKey(undefined)).toBeNull();
  });

  it("treats a whitespace-only env value as unset", () => {
    process.env.FIREWORKS_API_KEY = "   ";
    expect(resolveFireworksKey("")).toBeNull();
  });
});

describe("platformFireworksAvailable", () => {
  it("is true when the env key is set", () => {
    process.env.FIREWORKS_API_KEY = "super-secret-key";
    expect(platformFireworksAvailable()).toBe(true);
  });

  it("is false when no env key is configured", () => {
    clearEnv();
    expect(platformFireworksAvailable()).toBe(false);
  });

  it("is false for a whitespace-only env value", () => {
    process.env.FIREWORKS_API_KEY = "   ";
    expect(platformFireworksAvailable()).toBe(false);
  });
});

