/**
 * Download-specific request limiting (M20; spec `download` — "A download is bounded, abortable, and
 * fails in a form the caller can act on"; design decision 6).
 *
 * The shared `guardRequest` runs first and is not enough on its own, because its ceiling counts
 * *requests*. One download is a multi-megabyte transfer from a shared third party and a long-lived
 * function invocation, so a 60-per-minute request budget would permit roughly 300 MB per minute from
 * one caller — which is not what a personal download surface needs and not what the upstream can
 * absorb.
 *
 * Three limits, three different failure modes:
 *
 * - **Window** — how many downloads an address may *start* in ten minutes.
 * - **Concurrency per address** — a second concurrent download is **refused**, not queued, because a
 *   queued request holds a function invocation open for as long as the first transfer takes.
 * - **Concurrency per instance** — the upstream is shared and so is the function; four at a time is
 *   the same cap the catalogue's outbound limiter uses.
 *
 * ## Per-process, per-instance, and lost on restart
 *
 * Stated here, in the module's own documentation, and in the spec, for the reason
 * `http/throttle.ts` gives: it does not coordinate across serverless instances, it is not a quota,
 * and an over-claimed limiter is worse than none, because someone would later rely on it for
 * something it cannot do.
 */

import { createSemaphore, type Semaphore } from "@/server/music/limiter";

/** Downloads an address may start per window. Generous for a person, useless for a loop. */
export const DOWNLOAD_LIMIT = 6;

/** The window the ceiling is counted over. */
export const DOWNLOAD_WINDOW_MS = 10 * 60_000;

/**
 * Maximum distinct addresses tracked at once. Above this, the oldest window is dropped, because an
 * unbounded map is a slow memory leak with a security-shaped name.
 */
export const DOWNLOAD_MAX_KEYS = 5_000;

/** Concurrent downloads one instance will hold open. */
export const DOWNLOAD_CONCURRENCY_LIMIT = 4;

interface Window {
  resetAt: number;
  count: number;
  /** How many downloads are currently in flight for this address. */
  active: number;
}

const windows = new Map<string, Window>();

/**
 * One semaphore for the whole instance, mirroring the catalogue's outbound cap.
 *
 * `let` rather than `const` so {@link resetDownloadLimiter} can actually reset it. It was `const`
 * once, and that made the reset a half-reset: windows were cleared while the instance slots stayed
 * held, so one test's leaked permit silently became the next test's "instance is full" — a failure
 * in a test that had nothing to do with the leak, which is the hardest kind to diagnose.
 */
let instanceSlots: Semaphore = createSemaphore(DOWNLOAD_CONCURRENCY_LIMIT);

export type DownloadRefusal = "rate_limited" | "already_downloading" | "busy";

export interface DownloadRefusalResult {
  allowed: false;
  refusal: DownloadRefusal;
  retryAfterSeconds: number;
  limit: number;
}

export interface DownloadPermit {
  allowed: true;
  /** Releases both the per-address and per-instance slots. Idempotent. */
  release(): void;
  limit: number;
}

export type DownloadDecision = DownloadRefusalResult | DownloadPermit;

function evictIfFull(): void {
  if (windows.size < DOWNLOAD_MAX_KEYS) return;
  // Evict the oldest window **that has nothing in flight**. The first version took the oldest entry
  // unconditionally, which meant a window could be deleted while one of its downloads was still
  // transferring — and the `release()` that later arrived for that download could no longer find
  // the entry to decrement, so the per-address concurrency count for a key that was still live was
  // lost rather than returned. The leak was bounded by the instance semaphore, so it was never a
  // denial of service, but "bounded" is not the same as "correct", and an invariant that can be
  // broken by ordinary traffic is not an invariant.
  //
  // Falling back to the oldest entry when every window is active is deliberate: the map must stay
  // bounded even if every entry is live, because an unbounded map on a serverless instance is a
  // memory leak that no amount of correctness elsewhere excuses.
  for (const [key, window] of windows) {
    if (window.active === 0) {
      windows.delete(key);
      return;
    }
  }
  const oldest = windows.keys().next();
  if (!oldest.done) windows.delete(oldest.value);
}

/**
 * Take permission to download, or say why not.
 *
 * The window and per-address checks are synchronous and happen **before** the instance slot is
 * awaited, so a caller who is already downloading is refused without queueing behind anyone. The
 * instance slot is a FIFO semaphore, so a caller who passes the first two waits its turn rather than
 * being rejected for arriving while the instance was momentarily full — being *busy* is not the
 * caller's fault and should not read as a refusal.
 *
 * @param key a stable per-caller identity; `requestToAddress` is the intended source
 * @param signal the caller's signal, so a caller who leaves while queued does not take a slot
 */
export async function beginDownload(
  key: string,
  signal: AbortSignal,
  now = Date.now(),
): Promise<DownloadDecision> {
  const existing = windows.get(key);
  const window: Window =
    existing === undefined || existing.resetAt <= now
      ? { resetAt: now + DOWNLOAD_WINDOW_MS, count: 0, active: 0 }
      : existing;

  if (window.count >= DOWNLOAD_LIMIT) {
    // Deliberately not stored: a refused address must not create an entry, or a spray of forged
    // addresses would grow the map without ever being throttled.
    return {
      allowed: false,
      refusal: "rate_limited",
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
      limit: DOWNLOAD_LIMIT,
    };
  }
  if (window.active >= 1) {
    return {
      allowed: false,
      refusal: "already_downloading",
      retryAfterSeconds: 1,
      limit: DOWNLOAD_LIMIT,
    };
  }

  let releaseSlot: () => void;
  try {
    releaseSlot = await instanceSlots.acquire(signal);
  } catch {
    // The caller aborted while queued. Reported as a refusal rather than thrown, so the route can
    // answer 499 instead of surfacing an unhandled rejection from a request nobody is waiting for.
    return { allowed: false, refusal: "busy", retryAfterSeconds: 1, limit: DOWNLOAD_LIMIT };
  }

  evictIfFull();
  windows.set(key, window);
  window.count += 1;
  window.active += 1;

  let released = false;
  return {
    allowed: true,
    limit: DOWNLOAD_LIMIT,
    release() {
      if (released) return;
      released = true;
      const current = windows.get(key);
      if (current !== undefined && current.active > 0) current.active -= 1;
      releaseSlot();
    },
  };
}

/**
 * Drop every window and release every instance slot. Test isolation; nothing else should call it.
 *
 * Both halves matter — see the note on `instanceSlots`. A test that asserted only
 * `trackedDownloadKeys() === 0` would have passed while the semaphore stayed full.
 */
export function resetDownloadLimiter(): void {
  windows.clear();
  instanceSlots = createSemaphore(DOWNLOAD_CONCURRENCY_LIMIT);
}

/** How many addresses are currently tracked — bounded, and asserted to stay so. */
export function trackedDownloadKeys(): number {
  return windows.size;
}

/** How many instance slots are held. Observation and tests. */
export function heldInstanceSlots(): number {
  return instanceSlots.activeCount;
}
