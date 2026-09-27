/**
 * Next.js server instrumentation — runs once per server instance startup.
 * See `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateServerEnv } = await import("./server/env");
    validateServerEnv();
  }
}
