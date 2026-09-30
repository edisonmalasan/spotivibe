/**
 * Best-effort per-instance request throttling (M14; spec `security` — "Bounded
 * per-instance request throttling"; design decision 3).
 *
 * ## What this is for
 *
 * Every public route is an unauthenticated GET that can fan out to four third-party
 * providers. The instances behind those providers are a shared, finite resource: one
 * person looping a search spends every other person's access to them. This closes the
 * trivial loop.
 *
 * ## What this is not
 *
 * It is **per-process, per-instance, and lost on restart**. It does not coordinate
 * across serverless instances, it does not distinguish one person from another, and it
 * is not a quota. ROADMAP asks for exactly this and warns against pretending otherwise;
 * the limitation is stated here, in the module's own documentation, and in the spec,
 * because an over-claimed limiter is worse than none: someone would later rely on it
 * for something it cannot do.
 *
 * ## Why it is shaped this way
 *
 * - A **fixed window with a named ceiling**, generous relative to human use: a burst of
 *   searches and navigation is normal, a tight loop is not.
 * - A **bounded map** that evicts its own oldest entries. An unbounded limiter is a slow
 *   memory leak with a security-shaped name.
 * - A **documented weakness in the identity**: the address comes from
 *   `x-forwarded-for`, which a client can set. Behind a proxy that *overwrites* that
 *   header it is the real client; behind one that merely appends, the first entry is the
 *   caller's own claim, so a caller that rotates the header gets a fresh budget per
 *   request. The independent verification pass found this, and the honest response is to
 *   say so rather than to imply the loop is unconditionally closed: the route-class half
 *   of the key still holds, and the ceiling still bounds any single address.
 * - The key includes the **route class**, not the full path, so `/api/artist?id=a` and
 *   `?id=b` share one budget: the cost is the fan-out, not the query.
 */

/** Requests allowed per key per window. Generous for human use, useless for a loop. */
export const THROTTLE_LIMIT = 60;

/** The window the ceiling is counted over. */
export const THROTTLE_WINDOW_MS = 60_000;

/**
 * Maximum distinct keys held at once. Above this, the oldest entry is dropped.
 *
 * A local-first application with no accounts cannot have many legitimate clients, so
 * this is generous for the real shape of the deployment and small enough that a spray
 * of forged addresses cannot grow the map without limit.
 */
export const THROTTLE_MAX_KEYS = 5_000;

interface Window {
  /** Epoch ms at which this window ends. */
  resetAt: number;
  count: number;
}

/**
 * The limiter.
 *
 * A module-level map, because the state is per-process by definition: two instances of
 * the application each get their own. `resetThrottle` exists so a test can start from a
 * known state rather than inheriting the previous test's counts.
 */
const windows = new Map<string, Window>();

export interface ThrottleDecision {
  allowed: boolean;
  /** What the caller should say when refusing, including the ceiling. */
  retryAfterSeconds: number;
  limit: number;
}

/**
 * Decide whether one request is allowed, counting it if so.
 *
 * @param key the caller's stable identity plus a route class - see
 *   {@link throttleKeyFor}
 */
export function consumeThrottle(key: string, now = Date.now()): ThrottleDecision {
  const existing = windows.get(key);
  if (existing === undefined || existing.resetAt <= now) {
    evictIfFull();
    windows.set(key, { resetAt: now + THROTTLE_WINDOW_MS, count: 1 });
    return { allowed: true, retryAfterSeconds: 0, limit: THROTTLE_LIMIT };
  }
  existing.count += 1;
  if (existing.count <= THROTTLE_LIMIT) {
    return { allowed: true, retryAfterSeconds: 0, limit: THROTTLE_LIMIT };
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return { allowed: false, retryAfterSeconds, limit: THROTTLE_LIMIT };
}

/** Drop every window. Test isolation, and nothing else should call it. */
export function resetThrottle(): void {
  windows.clear();
}

/** How many keys are currently tracked - bounded, and asserted to stay so. */
export function trackedThrottleKeys(): number {
  return windows.size;
}

/**
 * Keep the map within its bound by dropping the oldest entry.
 *
 * `Map` preserves insertion order, so the first key is the oldest. Re-inserting on a
 * window rollover also refreshes its position, which is what makes this oldest-first
 * rather than arbitrary.
 */
function evictIfFull(): void {
  if (windows.size < THROTTLE_MAX_KEYS) return;
  const oldest = windows.keys().next();
  if (!oldest.done) windows.delete(oldest.value);
}

/**
 * The limiter's key: the caller's address and the route class.
 *
 * The class is the first path segment after `/api/` rather than the whole path, so the
 * budget tracks the expensive part (a provider fan-out) and cannot be sidestepped by
 * varying a query string.
 */
export function throttleKeyFor(address: string, pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const routeClass = segments[0] === "api" ? `/${segments.slice(0, 2).join("/")}` : "/other";
  return `${address}|${routeClass}`;
}

/**
 * The response for a refused request.
 *
 * `Retry-After` is required to be a delay in seconds, and a 429 has to say what the
 * caller can do next rather than just refusing - which is the difference between
 * throttling and obstructing.
 */
export function throttledResponse(decision: ThrottleDecision): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      limit: decision.limit,
      retryAfterSeconds: decision.retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(decision.retryAfterSeconds),
      },
    },
  );
}
