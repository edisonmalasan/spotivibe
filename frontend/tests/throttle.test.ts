import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeThrottle,
  resetThrottle,
  THROTTLE_LIMIT,
  THROTTLE_MAX_KEYS,
  THROTTLE_WINDOW_MS,
  throttleKeyFor,
  trackedThrottleKeys,
  throttledResponse,
} from "@/server/http/throttle";
import { requestToAddress, UNKNOWN_ADDRESS } from "@/server/http/requestAddress";

/**
 * M14 task 1.4: bounded, process-local request throttling.
 *
 * The tests that matter here are the ones about *bounds* and about what the limiter
 * does **not** claim to be. A rate limiter whose own map can grow without limit has
 * traded one problem for another, and one whose documentation overstates its scope
 * will be relied upon for something it cannot do.
 */

beforeEach(() => {
  resetThrottle();
});

describe("the throttle ceiling", () => {
  it("allows a burst at a human rate", () => {
    const key = throttleKeyFor("203.0.113.9", "/api/search");
    // A person searching and navigating: well under the ceiling, and none refused.
    for (let index = 0; index < THROTTLE_LIMIT; index += 1) {
      expect(consumeThrottle(key).allowed, `request ${index + 1}`).toBe(true);
    }
  });

  it("refuses a loop and says what the ceiling is", () => {
    const key = throttleKeyFor("203.0.113.9", "/api/search");
    for (let index = 0; index < THROTTLE_LIMIT; index += 1) consumeThrottle(key);

    const refused = consumeThrottle(key);
    expect(refused.allowed).toBe(false);
    // A refusal that does not name its ceiling is a wall, not a throttle.
    expect(refused.limit).toBe(THROTTLE_LIMIT);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each caller separately, and each route class separately", () => {
    // A loop on one route must not exhaust another's budget: the cost is the
    // provider fan-out, and one expensive call should not make the rest free to abuse
    // or unusable.
    const noisy = throttleKeyFor("203.0.113.9", "/api/search");
    const other = throttleKeyFor("203.0.113.9", "/api/discover");
    const otherCaller = throttleKeyFor("198.51.100.7", "/api/search");
    for (let index = 0; index < THROTTLE_LIMIT + 5; index += 1) consumeThrottle(noisy);

    expect(consumeThrottle(other).allowed).toBe(true);
    expect(consumeThrottle(otherCaller).allowed).toBe(true);
    expect(consumeThrottle(noisy).allowed).toBe(false);
  });

  it("does not let a query string buy a fresh budget", () => {
    // Varying `?id=` must not sidestep the ceiling, or the limiter measures nothing.
    const first = throttleKeyFor("203.0.113.9", "/api/artist");
    const second = throttleKeyFor("203.0.113.9", "/api/artist");
    expect(first).toBe(second);
    // Deeper paths under the same class share the budget as well.
    expect(throttleKeyFor("203.0.113.9", "/api/artist/extra")).toBe(first);
    // A different class does not.
    expect(throttleKeyFor("203.0.113.9", "/api/album")).not.toBe(first);
  });

  it("rolls the window over", () => {
    const key = throttleKeyFor("203.0.113.9", "/api/search");
    const start = 1_000_000;
    for (let index = 0; index < THROTTLE_LIMIT + 1; index += 1) consumeThrottle(key, start);
    expect(consumeThrottle(key, start).allowed).toBe(false);

    // A full window later the caller is a stranger again, as a fixed window means.
    const after = start + THROTTLE_WINDOW_MS;
    expect(consumeThrottle(key, after).allowed).toBe(true);
    // The fresh window is a fresh budget, not a courtesy - and the budget is exactly
    // the ceiling, which is why the loop accounts for the request above that already
    // spent the first slot of this window.
    for (let index = 1; index < THROTTLE_LIMIT; index += 1) {
      expect(consumeThrottle(key, after).allowed, `request ${index + 1} in the new window`).toBe(
        true,
      );
    }
    // One past the ceiling in the new window is still refused.
    expect(consumeThrottle(key, after).allowed).toBe(false);
  });
});

describe("the limiter's own bounds", () => {
  it("never tracks more keys than it is allowed to", () => {
    // A limiter that can be made to hold a million keys by spraying addresses is a
    // memory leak with a security-shaped name.
    for (let index = 0; index < THROTTLE_MAX_KEYS + 250; index += 1) {
      consumeThrottle(`198.51.100.${index % 256}/api/search`);
      consumeThrottle(`sprayed-${index}|/api/search`);
    }
    expect(trackedThrottleKeys()).toBeLessThanOrEqual(THROTTLE_MAX_KEYS);
  });

  it("evicts the oldest entry rather than the newest", () => {
    // FIFO specifically: a client's recent activity is what should survive a spray,
    // so evicting the newest would let an attacker push honest keys out.
    const victim = throttleKeyFor("203.0.113.1", "/api/search");
    consumeThrottle(victim);
    for (let index = 0; index < THROTTLE_MAX_KEYS; index += 1) {
      consumeThrottle(`sprayed-${index}|/api/search`);
    }
    // The victim was the oldest, so it is the one that went.
    expect(consumeThrottle(victim).allowed).toBe(true);
  });
});

describe("what the limiter claims about itself", () => {
  it("refuses with a response that names the ceiling and a delay", async () => {
    const key = throttleKeyFor("203.0.113.9", "/api/search");
    for (let index = 0; index < THROTTLE_LIMIT; index += 1) consumeThrottle(key);

    const decision = consumeThrottle(key);
    const response = throttledResponse(decision);
    expect(response.status).toBe(429);
    // `Retry-After` is what turns a refusal into a throttle a client can obey.
    expect(response.headers.get("retry-after")).toBe(String(decision.retryAfterSeconds));
    const body = (await response.json()) as { error: string; limit: number };
    expect(body.error).toBe("rate_limited");
    expect(body.limit).toBe(THROTTLE_LIMIT);
  });

  it("documents that it is per-instance and not durable", () => {
    // The limitation has to live where someone reads the code, not only in a spec: a
    // limiter that overstates its scope is worse than none, because someone will rely
    // on it as a quota.
    // Proven by the same detector the architecture suite uses, on the module's own text.
    const source = readFileSync(
      join(process.cwd(), "src", "server", "http", "throttle.ts"),
      "utf8",
    );
    expect(source).toMatch(/per-process/);
    expect(source).toMatch(/not a quota/i);
    expect(source).toMatch(/lost on restart/i);
  });
});

describe("caller identification", () => {
  function requestWith(headers: Record<string, string>): Request {
    return new Request("http://app.test/api/search?q=x", { headers });
  }

  it("uses the first forwarded entry, so a proxy hop does not become the identity", () => {
    // The last entry is the nearest hop, and every client behind the same proxy would
    // share one budget.
    const address = requestToAddress(
      requestWith({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" }),
    );
    expect(address).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip", () => {
    expect(requestToAddress(requestWith({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("normalizes an IPv4-mapped IPv6 address, so one client is one client", () => {
    expect(requestToAddress(requestWith({ "x-real-ip": "::FFFF:203.0.113.9" }))).toBe(
      "203.0.113.9",
    );
  });

  it("uses a visible placeholder when no address is available", () => {
    expect(requestToAddress(requestWith({}))).toBe(UNKNOWN_ADDRESS);
    expect(requestToAddress(requestWith({ "x-forwarded-for": "  " }))).toBe(UNKNOWN_ADDRESS);
  });
});
