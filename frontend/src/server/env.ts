import { z } from "zod";

/**
 * Server-only environment variables.
 *
 * Empty at M0: Spotivibe needs no server-side provider/config values yet.
 * When a milestone introduces one (for example provider configuration in M3):
 *   1. add it to this schema,
 *   2. document it in `.env.example`,
 *   3. read it only through this module — never from client code.
 *
 * Secrets must never be prefixed with `NEXT_PUBLIC_`.
 */
const serverEnvSchema = z.object({});

/**
 * Client-exposed environment variables (`NEXT_PUBLIC_*`).
 *
 * Empty at M0. Every `NEXT_PUBLIC_*` variable must be explicitly declared
 * here as safe before use, otherwise server startup fails. This is the guard
 * that keeps secrets from being shipped to the browser bundle by accident.
 */
const clientEnvSchema = z.object({});

/** Prefix that Next.js inlines into the browser bundle. */
export const PUBLIC_ENV_PREFIX = "NEXT_PUBLIC_";

export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Environment validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

export interface ValidatedEnv {
  server: z.infer<typeof serverEnvSchema>;
  client: z.infer<typeof clientEnvSchema>;
}

/**
 * Validate a candidate environment.
 *
 * Pure function so it can be unit tested; server boot calls
 * {@link validateServerEnv}. Unknown non-public variables are ignored
 * (the runtime and host set many), but an undeclared `NEXT_PUBLIC_*`
 * variable is a hard failure.
 *
 * @throws {EnvValidationError} when the environment is invalid.
 */
export function validateEnv(env: Record<string, string | undefined>): ValidatedEnv {
  const issues: string[] = [];
  const serverInput: Record<string, string> = {};
  const clientInput: Record<string, string> = {};
  const declaredClientKeys = Object.keys(clientEnvSchema.shape);

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.startsWith(PUBLIC_ENV_PREFIX)) {
      clientInput[key] = value;
      if (!declaredClientKeys.includes(key)) {
        issues.push(
          `${key} reaches the browser bundle but is not declared safe in clientEnvSchema (src/server/env.ts)`,
        );
      }
    } else {
      serverInput[key] = value;
    }
  }

  const serverResult = serverEnvSchema.safeParse(serverInput);
  if (!serverResult.success) {
    for (const issue of serverResult.error.issues) {
      issues.push(`server env ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  }

  const clientResult = clientEnvSchema.safeParse(clientInput);
  if (!clientResult.success) {
    for (const issue of clientResult.error.issues) {
      issues.push(`client env ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  }

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  return {
    server: serverResult.success ? serverResult.data : {},
    client: clientResult.success ? clientResult.data : {},
  };
}

/** Validate `process.env` at server startup (see `src/instrumentation.ts`). */
export function validateServerEnv(): ValidatedEnv {
  return validateEnv(process.env);
}
