import { describe, expect, it, vi } from "vitest";
import { EnvValidationError, getServerEnv, validateEnv } from "@/server/env";

describe("validateEnv", () => {
  it("accepts an environment with no application variables", () => {
    expect(validateEnv({})).toEqual({ server: {}, client: {} });
  });

  it("ignores non-application runtime variables set by the host", () => {
    const env = { NODE_ENV: "production", NEXT_RUNTIME: "nodejs", VERCEL_ENV: "production" };
    expect(validateEnv(env)).toEqual({ server: {}, client: {} });
  });

  it("rejects an undeclared NEXT_PUBLIC_ variable", () => {
    expect(() => validateEnv({ NEXT_PUBLIC_API_KEY: "secret" })).toThrow(EnvValidationError);
    try {
      validateEnv({ NEXT_PUBLIC_API_KEY: "secret" });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as Error).message).toContain("NEXT_PUBLIC_API_KEY");
    }
  });

  it("reports every undeclared public variable in one failure", () => {
    try {
      validateEnv({ NEXT_PUBLIC_TOKEN_A: "a", NEXT_PUBLIC_TOKEN_B: "b" });
      expect.unreachable("validation should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as Error).message;
      expect(message).toContain("NEXT_PUBLIC_TOKEN_A");
      expect(message).toContain("NEXT_PUBLIC_TOKEN_B");
    }
  });

  it("accepts declared optional provider instance overrides", () => {
    const result = validateEnv({
      SPOTIVIBE_INVIDIOUS_INSTANCES: "https://yewtu.be,https://invidious.f5.si",
      SPOTIVIBE_PIPED_INSTANCES: "https://pipedapi.ducks.party",
    });
    expect(result.server.SPOTIVIBE_INVIDIOUS_INSTANCES).toBe(
      "https://yewtu.be,https://invidious.f5.si",
    );
    expect(result.server.SPOTIVIBE_PIPED_INSTANCES).toBe("https://pipedapi.ducks.party");
  });
});

describe("getServerEnv", () => {
  it("is startup-safe when no provider values are set", () => {
    vi.stubEnv("SPOTIVIBE_INVIDIOUS_INSTANCES", undefined);
    vi.stubEnv("SPOTIVIBE_PIPED_INSTANCES", undefined);
    try {
      const server = getServerEnv();
      expect(server.SPOTIVIBE_INVIDIOUS_INSTANCES).toBeUndefined();
      expect(server.SPOTIVIBE_PIPED_INSTANCES).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reads runtime values through the validated schema", () => {
    vi.stubEnv("SPOTIVIBE_PIPED_INSTANCES", "https://pipedapi.ducks.party");
    try {
      expect(getServerEnv().SPOTIVIBE_PIPED_INSTANCES).toBe("https://pipedapi.ducks.party");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
