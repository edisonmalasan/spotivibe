/**
 * Bounded outbound-concurrency primitive (design decision 6: a FIFO
 * in-module semaphore capping concurrent provider requests at 4 per runtime
 * instance — best-effort, documented).
 *
 * The shared instance at the bottom is deliberate cross-cutting state: one
 * cap per server process, mirroring the reference's outbound queue.
 */

/** A FIFO concurrency gate: `acquire` resolves to a `release` callback. */
export interface Semaphore {
  /**
   * Wait for a slot. Resolves with a release function (idempotent).
   * Rejects with an `AbortError` if the caller's signal aborts while queued —
   * queued-but-cancelled requests exit without firing upstream.
   */
  acquire(signal?: AbortSignal): Promise<() => void>;
  /** Slots currently held (observation/testing). */
  readonly activeCount: number;
  /** Waiters currently queued (observation/testing). */
  readonly pendingCount: number;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export function createSemaphore(limit: number): Semaphore {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`semaphore limit must be a positive integer, got ${limit}`);
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
      waiter.resolve(() => {
        if (released) return;
        released = true;
        active -= 1;
        tryStart();
      });
    }
  }

  return {
    acquire(signal?: AbortSignal): Promise<() => void> {
      if (signal?.aborted) {
        return Promise.reject(
          signal.reason ?? new DOMException("The operation was aborted.", "AbortError"),
        );
      }
      return new Promise<() => void>((resolve, reject) => {
        const waiter: Waiter = { resolve, reject, signal };
        if (signal) {
          waiter.onAbort = () => {
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

/** Global per-instance cap on concurrent outbound provider requests. */
export const OUTBOUND_CONCURRENCY_LIMIT = 4;
export const outboundLimiter = createSemaphore(OUTBOUND_CONCURRENCY_LIMIT);
