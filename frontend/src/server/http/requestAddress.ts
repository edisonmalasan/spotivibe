/**
 * How the server identifies the caller for its own bookkeeping (M14).
 *
 * Deliberately separate from the throttle's policy, because the two change for
 * different reasons and conflating them is how "per-instance" quietly becomes
 * "per-user", which this application cannot be: it has no accounts and no user
 * identity of any kind.
 *
 * The address is whatever the deployment tells us, in this order:
 *
 * 1. `x-forwarded-for`'s **first** entry, which is the original client when a proxy is
 *    in front of the application (Vercel sets it). The last entry would be the
 *    nearest hop and every client would share one budget.
 * 2. `x-real-ip`, for proxies that use that instead.
 * 3. A constant placeholder when neither is present.
 *
 * The placeholder matters: without it, an unidentified caller would key on `""` and
 * every such caller would share a single global budget - one noisy client could exhaust
 * it for everyone behind the same proxy configuration. Instead each such request is
 * keyed by its own route class under a shared, visible label, and the spec says plainly
 * that this is best-effort.
 */

/** Used when no address can be determined. See the module note. */
export const UNKNOWN_ADDRESS = "unknown";

/** First entry of `x-forwarded-for`, or the next best signal. */
export function requestToAddress(request: Request): string {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return normalizeAddress(first);
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return normalizeAddress(realIp);
  return UNKNOWN_ADDRESS;
}

/**
 * Normalize an address for use as a map key.
 *
 * IPv6 in particular arrives in many spellings of the same address, and a limiter
 * keyed on the raw string would hand one client several budgets.
 */
function normalizeAddress(address: string): string {
  const trimmed = address.trim().toLowerCase();
  // `::ffff:203.0.113.9` and `203.0.113.9` are the same client to every proxy and
  // runtime that matters here.
  const mapped = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}
