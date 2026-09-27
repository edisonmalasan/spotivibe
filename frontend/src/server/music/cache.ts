/**
 * In-module resilience primitives (design decisions 6–8): a bounded TTL
 * result cache and in-flight request deduplication. Both are key-based,
 * plain-Map stores with no external dependency — best-effort per runtime
 * instance, shared at the search-service layer.
 */

export interface TtlCache<V> {
  /** Value for `key` when present and unexpired; otherwise `undefined`. */
  get(key: string): V | undefined;
  /** Insert or refresh `key`, evicting the oldest entry beyond `maxEntries`. */
  set(key: string, value: V): void;
  /** Current entry count (observation/testing). */
  readonly size: number;
}

export interface TtlCacheOptions {
  ttlMs: number;
  maxEntries: number;
  /** Injectable clock (testing). */
  now?: () => number;
}

export function createTtlCache<V>(options: TtlCacheOptions): TtlCache<V> {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: V; expiresAt: number }>();
  return {
    get(key: string): V | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: V): void {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + options.ttlMs });
      // Map preserves insertion order — the first key is the oldest.
      while (entries.size > options.maxEntries) {
        const oldest = entries.keys().next().value as string;
        entries.delete(oldest);
      }
    },
    get size(): number {
      return entries.size;
    },
  };
}

/** Shares one in-flight promise per key; entries are removed on settle. */
export interface InflightDedup<V> {
  /**
   * Run `factory` under `key`, or join an identical in-flight run.
   * Rejections are shared with every waiter, and the key is freed on settle.
   */
  run(key: string, factory: () => Promise<V>): Promise<V>;
  /** Current in-flight entry count (observation/testing). */
  readonly size: number;
}

export function createInflightDedup<V>(): InflightDedup<V> {
  const inflight = new Map<string, Promise<V>>();
  return {
    run(key: string, factory: () => Promise<V>): Promise<V> {
      const existing = inflight.get(key);
      if (existing) return existing;
      const promise = Promise.resolve().then(factory);
      inflight.set(key, promise);
      const clear = () => {
        if (inflight.get(key) === promise) inflight.delete(key);
      };
      void promise.then(clear, clear);
      return promise;
    },
    get size(): number {
      return inflight.size;
    },
  };
}
