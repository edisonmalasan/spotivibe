import { describe, expect, it } from "vitest";
import { EnvValidationError, validateEnv } from "@/server/env";

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
});
