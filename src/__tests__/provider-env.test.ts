import { describe, it, expect, afterEach } from "vitest";
import {
  platformKeyFor,
  resolveServerApiKey,
  platformProviderAvailability,
} from "@/server/provider-env";

const ENV_VARS = [
  "PROVIDED_ANTHROPIC_API_KEY",
  "PROVIDED_OPENAI_API_KEY",
  "PROVIDED_XAI_API_KEY",
] as const;

function clearEnv() {
  for (const v of ENV_VARS) delete process.env[v];
}

afterEach(clearEnv);

describe("platformKeyFor", () => {
  it("returns null when the env var is unset", () => {
    clearEnv();
    expect(platformKeyFor("anthropic")).toBeNull();
  });

  it("returns the trimmed env value when set", () => {
    process.env.PROVIDED_ANTHROPIC_API_KEY = "  sk-ant-xyz  ";
    expect(platformKeyFor("anthropic")).toBe("sk-ant-xyz");
  });

  it("treats a whitespace-only env value as unset", () => {
    process.env.PROVIDED_OPENAI_API_KEY = "   ";
    expect(platformKeyFor("openai")).toBeNull();
  });

  it("never has a fallback for inference-compatible providers", () => {
    process.env.PROVIDED_ANTHROPIC_API_KEY = "sk-ant-xyz";
    expect(platformKeyFor("openai_compatible")).toBeNull();
  });
});

describe("resolveServerApiKey", () => {
  it("uses the caller's inline key when present (trimmed)", () => {
    process.env.PROVIDED_OPENAI_API_KEY = "platform-key";
    expect(resolveServerApiKey("openai", "  user-key  ")).toBe("user-key");
  });

  it("falls back to the platform key when no inline key", () => {
    process.env.PROVIDED_XAI_API_KEY = "platform-xai";
    expect(resolveServerApiKey("xai", "")).toBe("platform-xai");
    expect(resolveServerApiKey("xai", undefined)).toBe("platform-xai");
    expect(resolveServerApiKey("xai", "   ")).toBe("platform-xai");
  });

  it("returns null when both inline and env are empty", () => {
    clearEnv();
    expect(resolveServerApiKey("anthropic", "")).toBeNull();
  });

  it("returns null for openai_compatible without an inline key (no env fallback)", () => {
    expect(resolveServerApiKey("openai_compatible", "")).toBeNull();
  });

  it("still returns the inline key for openai_compatible when provided", () => {
    expect(resolveServerApiKey("openai_compatible", "local-key")).toBe(
      "local-key",
    );
  });
});

describe("platformProviderAvailability", () => {
  it("reports booleans only and never the key itself", () => {
    process.env.PROVIDED_ANTHROPIC_API_KEY = "super-secret-key";
    const avail = platformProviderAvailability();
    expect(avail.anthropic).toBe(true);
    expect(avail.openai).toBe(false);
    expect(avail.xai).toBe(false);
    expect(avail.openai_compatible).toBe(false);
    // Leak guard: no value in the payload is the secret string.
    expect(JSON.stringify(avail)).not.toContain("super-secret-key");
    for (const v of Object.values(avail)) {
      expect(typeof v).toBe("boolean");
    }
  });

  it("is all-false when no platform keys are configured", () => {
    clearEnv();
    expect(platformProviderAvailability()).toEqual({
      anthropic: false,
      openai: false,
      xai: false,
      openai_compatible: false,
    });
  });
});
