/**
 * The one place a public route enters the throttled boundary (M14; spec `security` —
 * "Bounded per-instance request throttling").
 *
 * Routes call {@link guardRequest} first and return its response when there is one.
 * Concentrating it here means a new route cannot forget the boundary, and it keeps the
 * policy in one module instead of seven copies - which is the difference between a
 * ceiling someone can reason about and seven numbers that drift apart.
 */
import { requestToAddress } from "./requestAddress";
import { consumeThrottle, throttleKeyFor, throttledResponse } from "./throttle";

/**
 * The throttle decision for a request, or `null` when it may proceed.
 *
 * Returns the response rather than a boolean so the caller cannot construct a refusal
 * differently from the one the limiter documents: a 429 that omits `Retry-After`, or
 * names a different ceiling, is how a throttle turns into an obstruction.
 */
export function guardRequest(request: Request): Response | null {
  const { pathname } = new URL(request.url);
  const decision = consumeThrottle(throttleKeyFor(requestToAddress(request), pathname));
  return decision.allowed ? null : throttledResponse(decision);
}
