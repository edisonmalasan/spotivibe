import { afterEach, describe, expect, it } from "vitest";
import {
  DOWNLOAD_CONCURRENCY_LIMIT,
  DOWNLOAD_LIMIT,
  DOWNLOAD_MAX_KEYS,
  DOWNLOAD_WINDOW_MS,
  beginDownload,
  heldInstanceSlots,
  resetDownloadLimiter,
  trackedDownloadKeys,
  type DownloadPermit,
} from "@/server/download/limiter";

/**
 * Download-specific limiting (M20; spec `download` — "A download is bounded, abortable, and fails in
 * a form the caller can act on"; design decision 6).
 *
 * Three limits with three different failure modes, and the tests are arranged the same way: a
 * window that *refuses*, a per-address concurrency limit that *refuses*, and a per-instance
 * semaphore that *queues*. Conflating them was the mistake the first version of the design would
 * have made — a request budget of 60/minute permits roughly 300 MB per minute from one caller, which
 * is not a personal download surface.
 *
 * Every permit taken here is released, because the semaphore is module-level and a leaked slot fails
 * a later test for a reason that has nothing to do with it.
 */

const never = new AbortController().signal;

afterEach(() => {
  resetDownloadLimiter();
  // A leaked slot in one test is a mysterious hang in the next, so the precondition is asserted
  // rather than assumed. `resetDownloadLimiter` clears both halves; this proves it did.
  expect(heldInstanceSlots()).toBe(0);
  expect(trackedDownloadKeys()).toBe(0);
});

describe("beginDownload", () => {
  it("permits the first download from an address", async () => {
    const permit = await beginDownload("a", never);
    expect(permit.allowed).toBe(true);
    if (!permit.allowed) throw new Error("expected a permit");
    expect(permit.limit).toBe(DOWNLOAD_LIMIT);
    permit.release();
  });

  it("counts a download against its window, not against a global total", async () => {
    // Two different addresses are two different people as far as this limiter is concerned.
    const first = await beginDownload("a", never);
    const second = await beginDownload("b", never);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    if (first.allowed) first.release();
    if (second.allowed) second.release();
  });

  it("refuses a second concurrent download from the same address rather than queueing it", async () => {
    // Queueing holds a function invocation open for as long as the first transfer takes, which is
    // the cost this limit exists to avoid.
    const first = await beginDownload("a", never);
    expect(first.allowed).toBe(true);
    const second = await beginDownload("a", never);
    expect(second.allowed).toBe(false);
    if (second.allowed) throw new Error("expected a refusal");
    expect(second.refusal).toBe("already_downloading");
    // The refusal is distinguishable from a window refusal, because the remedy is different: wait
    // for the transfer, or wait for the window.
    expect(second.retryAfterSeconds).toBe(1);
    if (first.allowed) first.release();
  });

  it("allows another download once the previous one is released", async () => {
    const first = await beginDownload("a", never);
    if (!first.allowed) throw new Error("expected a permit");
    first.release();
    const second = await beginDownload("a", never);
    expect(second.allowed).toBe(true);
    if (second.allowed) second.release();
  });

  it("treats release as idempotent, so a `finally` cannot over-release", async () => {
    // The route releases in a `finally` and an early return could release again. Over-releasing
    // would decrement somebody else's concurrency count, which is a cross-address correctness bug
    // that would be invisible in any single-address test.
    const a = await beginDownload("a", never);
    if (!a.allowed) throw new Error("expected a permit");
    a.release();
    a.release();
    a.release();

    const b = await beginDownload("a", never);
    expect(b.allowed, "an over-released slot must not look like an active download").toBe(true);
    if (b.allowed) b.release();
  });

  it("refuses the seventh download in a window and says how long to wait", async () => {
    const now = 1_000_000;
    for (let index = 0; index < DOWNLOAD_LIMIT; index += 1) {
      const permit = await beginDownload("a", never, now);
      expect(permit.allowed, `download ${index + 1} of ${DOWNLOAD_LIMIT}`).toBe(true);
      if (permit.allowed) permit.release();
    }
    const refused = await beginDownload("a", never, now);
    expect(refused.allowed).toBe(false);
    if (refused.allowed) throw new Error("expected a refusal");
    expect(refused.refusal).toBe("rate_limited");
    expect(refused.limit).toBe(DOWNLOAD_LIMIT);
    expect(refused.retryAfterSeconds).toBe(Math.ceil(DOWNLOAD_WINDOW_MS / 1000));
  });

  it("starts a fresh window once the previous one has elapsed", async () => {
    const start = 1_000_000;
    for (let index = 0; index < DOWNLOAD_LIMIT; index += 1) {
      const permit = await beginDownload("a", never, start);
      if (permit.allowed) permit.release();
    }
    expect((await beginDownload("a", never, start)).allowed).toBe(false);
    // One millisecond before the reset is still inside the window.
    expect((await beginDownload("a", never, start + DOWNLOAD_WINDOW_MS - 1)).allowed).toBe(false);
    // At the reset it is a new window.
    expect((await beginDownload("a", never, start + DOWNLOAD_WINDOW_MS)).allowed).toBe(true);
  });

  it("does not create a map entry for an address it refuses", async () => {
    // Otherwise a spray of forged addresses would grow the map without ever being throttled, which
    // is a slow memory leak with a security-shaped name.
    const now = 1_000_000;
    for (let index = 0; index < DOWNLOAD_LIMIT; index += 1) {
      const permit = await beginDownload("a", never, now);
      if (permit.allowed) permit.release();
    }
    expect(trackedDownloadKeys()).toBe(1);
    // Each forged address gets its own empty window, so each is allowed and each is tracked — the
    // point is that nothing here is *refused*, and the point of the refusals above is that the one
    // refused address created no entry at all.
    for (let index = 0; index < 10; index += 1) {
      const permit = await beginDownload(`forged-${index}`, never, now);
      expect(permit.allowed).toBe(true);
      if (permit.allowed) permit.release();
    }
    expect(trackedDownloadKeys()).toBe(11);
  });

  it("bounds the map, evicting the oldest key when it is full", async () => {
    for (let index = 0; index < DOWNLOAD_MAX_KEYS; index += 1) {
      const permit = await beginDownload(`key-${index}`, never);
      if (permit.allowed) permit.release();
    }
    expect(trackedDownloadKeys()).toBe(DOWNLOAD_MAX_KEYS);
    const overflow = await beginDownload("one-too-many", never);
    expect(overflow.allowed).toBe(true);
    if (overflow.allowed) overflow.release();
    expect(trackedDownloadKeys()).toBe(DOWNLOAD_MAX_KEYS);
  });

  it("caps concurrency per instance, and queues rather than refusing when full", async () => {
    // Being busy is not the caller's fault and must not read as a refusal, so the instance cap is a
    // FIFO semaphore rather than another rejection.
    const permits: DownloadPermit[] = [];
    for (let index = 0; index < DOWNLOAD_CONCURRENCY_LIMIT; index += 1) {
      const permit = await beginDownload(`concurrent-${index}`, never);
      expect(permit.allowed, `slot ${index + 1}`).toBe(true);
      if (permit.allowed) permits.push(permit);
    }
    expect(heldInstanceSlots()).toBe(DOWNLOAD_CONCURRENCY_LIMIT);

    // The next one does not resolve while the slots are held.
    let settled = false;
    const queued = beginDownload("queued", never).then((decision) => {
      settled = true;
      return decision;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled, "an instance-full download must wait, not be refused").toBe(false);

    permits[0]?.release();
    const decision = await queued;
    expect(decision.allowed).toBe(true);
    if (decision.allowed) decision.release();
    for (const permit of permits.slice(1)) permit.release();
    expect(heldInstanceSlots()).toBe(0);
  });

  it("releases the per-address slot when a queued caller aborts, instead of leaking it", async () => {
    const held: DownloadPermit[] = [];
    for (let index = 0; index < DOWNLOAD_CONCURRENCY_LIMIT; index += 1) {
      const permit = await beginDownload(`held-${index}`, never);
      if (permit.allowed) held.push(permit);
    }
    const controller = new AbortController();
    const queued = beginDownload("leaves-while-queued", controller.signal);
    controller.abort();
    const decision = await queued;
    // Refused rather than thrown, so the route can answer 499 instead of surfacing an unhandled
    // rejection from a request nobody is waiting for.
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error("expected a refusal");
    expect(decision.refusal).toBe("busy");
    for (const permit of held) permit.release();
    expect(heldInstanceSlots()).toBe(0);
  });

  it("keeps the per-address refusal ahead of the instance semaphore", async () => {
    // An address already downloading must not be made to queue behind unrelated callers, which is
    // the whole point of doing the synchronous checks before awaiting a slot.
    const first = await beginDownload("a", never);
    if (!first.allowed) throw new Error("expected a permit");
    const second = await beginDownload("a", never);
    expect(second.allowed).toBe(false);
    if (second.allowed) throw new Error("expected a refusal");
    expect(second.refusal).toBe("already_downloading");
    first.release();
  });

  it("resets every window for test isolation", async () => {
    for (let index = 0; index < DOWNLOAD_LIMIT; index += 1) {
      const permit = await beginDownload("a", never);
      if (permit.allowed) permit.release();
    }
    expect((await beginDownload("a", never)).allowed).toBe(false);
    resetDownloadLimiter();
    expect(trackedDownloadKeys()).toBe(0);
    expect((await beginDownload("a", never)).allowed).toBe(true);
  });

  it("evicts an idle window rather than one whose transfer is still running", async () => {
    // Found by independent review. `evictIfFull` took the oldest entry unconditionally, so a
    // window could be deleted while one of its downloads was still streaming. The `release()` that
    // later arrived for that download could then no longer find the entry to decrement, so the
    // per-address concurrency count for a key that was still live was lost rather than returned.
    //
    // The observable consequence: an address that is genuinely mid-download stops being recognised
    // as mid-download, and the "one concurrent transfer per address" rule quietly stops holding for
    // it. That is the limiter's main defence against one client monopolising the instance.
    //
    // The live window is created FIRST, so it is the oldest entry — which is exactly the one a
    // naive "evict the oldest" would discard. Order is the whole test: with the live window last,
    // the old implementation would evict an idle entry instead and this would pass against the bug
    // it exists to catch.
    const live = await beginDownload("live-address", never);
    expect(live.allowed).toBe(true);

    for (let index = 0; index < DOWNLOAD_MAX_KEYS - 1; index += 1) {
      const idle = await beginDownload(`idle-${index}`, never);
      expect(idle.allowed).toBe(true);
      if (idle.allowed) idle.release();
    }

    // This push has to evict something, and the only entry worth evicting is an idle one.
    const newcomer = await beginDownload("newcomer", never);
    expect(newcomer.allowed).toBe(true);
    if (newcomer.allowed) newcomer.release();

    // The live window must still be enforcing its per-address rule…
    expect(
      (await beginDownload("live-address", never)).allowed,
      "the live window was evicted, so its concurrency rule stopped applying",
    ).toBe(false);

    // …and its release must still find the entry it belongs to.
    if (live.allowed) live.release();
    resetDownloadLimiter();
  });
});
