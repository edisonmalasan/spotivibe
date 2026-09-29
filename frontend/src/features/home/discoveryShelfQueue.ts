"use client";

/**
 * Page-wide gate for discovery shelf requests (M8, design §2).
 *
 * Every rendered shelf owns its own hook instance and its own
 * `AbortController`, which is what isolates one shelf's failure from its
 * siblings' — but it also means a page of shelves fires every request at once.
 * Discover renders ten genre shelves and Home renders several catalog feeds, so
 * one page can put 10+ feed requests on the wire together, and each feed
 * server-side fans out to up to {@link DISCOVERY_SEED_CAP} chain calls. That is
 * exactly the fan-out that makes a multi-language page fail: the server's
 * outbound limiter has four slots and each chain's budget clock starts before
 * it queues for one, so a queued seed is reported as `timeout` long before it
 * reaches a provider.
 *
 * This module bounds the page side of that fan-out to
 * {@link MAX_CONCURRENT_SHELF_REQUESTS} in-flight feed requests. Shelves beyond
 * the cap wait their turn, still reporting `"loading"` — the same status they
 * report while a request is in flight — so the cap is invisible in the UI and
 * costs nothing in shelf independence.
 *
 * The wait is **abortable**. A shelf that unmounts, is superseded, or is
 * disabled while queued must leave the queue without ever issuing a request and
 * without holding a slot, so a scrolled-away shelf can never stall the ones
 * behind it.
 *
 * Deliberately its own tiny FIFO rather than the server's `outboundLimiter`:
 * that limiter is a server module, and client code reaching into `src/server`
 * is precisely what the architecture rules forbid (and what would couple a
 * browser tab to a server process's state). The shared instance below is the
 * same kind of documented, module-level cross-cutting singleton the server
 * limiter is.
 */

/**
 * Cap on discovery feed requests in flight across **all** shelves on the page.
 *
 * Three is deliberately below the server limiter's four slots: three shelves ×
 * one seed at a time cannot saturate the limiter, so a feed's own seeds reach a
 * slot without queueing and the per-seed budget is spent querying rather than
 * waiting. Raising it past the limiter's capacity re-introduces the exact
 * queue-while-budgeted failure this gate exists to prevent.
 */
export const MAX_CONCURRENT_SHELF_REQUESTS = 3;

/** A held slot; `release` is idempotent and hands the slot to the next waiter. */
export interface ShelfSlot {
  release(): void;
}

interface Waiter {
  resolve: (slot: ShelfSlot) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** A FIFO gate over shelf requests: at most `limit` held at once. */
export interface ShelfRequestQueue {
  /**
   * Wait for a slot. Resolves with a lease once one is free; rejects with the
   * signal's reason if `signal` aborts while queued — in which case no slot was
   * ever taken and the caller must not issue a request.
   */
  acquire(signal?: AbortSignal): Promise<ShelfSlot>;
  /** Slots currently held (observation/testing). */
  readonly activeCount: number;
  /** Shelves currently waiting for a slot (observation/testing). */
  readonly pendingCount: number;
}

/**
 * Build a FIFO shelf-request gate. Small and explicit on purpose: it is the one
 * piece of scheduling the page needs, and the abort path (a queued shelf that
 * leaves) is the part that must not leak a slot.
 */
export function createShelfRequestQueue(limit: number): ShelfRequestQueue {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`shelf request limit must be a positive integer, got ${limit}`);
  }
  let active = 0;
  const queue: Waiter[] = [];

  function tryStart(): void {
    while (active < limit && queue.length > 0) {
      const waiter = queue.shift() as Waiter;
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      active += 1;
      let released = false;
      waiter.resolve({
        release(): void {
          if (released) return;
          released = true;
          active -= 1;
          tryStart();
        },
      });
    }
  }

  return {
    acquire(signal?: AbortSignal): Promise<ShelfSlot> {
      if (signal?.aborted) {
        return Promise.reject(
          signal.reason ?? new DOMException("The operation was aborted.", "AbortError"),
        );
      }
      return new Promise<ShelfSlot>((resolve, reject) => {
        const waiter: Waiter = { resolve, reject, signal };
        if (signal) {
          waiter.onAbort = () => {
            // Leaving the queue must not consume a slot: the waiter never
            // started, so there is nothing to release.
            const index = queue.indexOf(waiter);
            if (index >= 0) queue.splice(index, 1);
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
          };
          signal.addEventListener("abort", waiter.onAbort, { once: true });
        }
        queue.push(waiter);
        tryStart();
      });
    },
    get activeCount(): number {
      return active;
    },
    get pendingCount(): number {
      return queue.length;
    },
  };
}

/** The one gate every discovery shelf on the page shares. */
export const shelfRequestQueue: ShelfRequestQueue = createShelfRequestQueue(
  MAX_CONCURRENT_SHELF_REQUESTS,
);

/** Shelf requests currently in flight across every shelf (observation/testing). */
export function activeShelfRequests(): number {
  return shelfRequestQueue.activeCount;
}

/** Shelves currently waiting for a slot (observation/testing). */
export function queuedShelfRequests(): number {
  return shelfRequestQueue.pendingCount;
}

/** Wait for one of the page's {@link MAX_CONCURRENT_SHELF_REQUESTS} slots. */
export function acquireShelfSlot(signal?: AbortSignal): Promise<ShelfSlot> {
  return shelfRequestQueue.acquire(signal);
}
