/**
 * Transport helper for provider requests: JSON fetch with a bounded
 * per-attempt timeout and caller-abort propagation (spec: provider timeouts
 * and abort propagation). Pure HTTP concern — no music-domain knowledge.
 */

/** Failure taxonomy shared with the provider layer (`timeout | network | http | parse`). */
export type HttpFailureKind = "timeout" | "network" | "http" | "parse";

/** A failed upstream fetch, classified by kind. */
export class HttpFetchError extends Error {
  readonly kind: HttpFailureKind;
  readonly status?: number;

  constructor(
    kind: HttpFailureKind,
    message: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(message, options);
    this.name = "HttpFetchError";
    this.kind = kind;
    this.status = options?.status;
  }
}

export interface FetchJsonOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /**
   * Caller signal (the incoming route request's abort signal). When it
   * aborts, the original abort error propagates untouched so the orchestrator
   * can distinguish cancellation from an upstream failure.
   */
  signal?: AbortSignal;
  /** Per-attempt timeout in milliseconds. */
  timeoutMs: number;
}

/**
 * Fetch `url` and parse the response as JSON.
 *
 * - Timeout and caller abort are composed with `AbortSignal.any`; a timeout
 *   rejects with {@link HttpFetchError} kind `timeout`, while a caller abort
 *   re-throws the original `AbortError` (not treated as a tier failure).
 * - Non-2xx responses reject with kind `http` (status retained).
 * - Unparsable bodies reject with kind `parse`.
 * - Network-level failures (DNS, connection reset) reject with kind `network`.
 *
 * @throws {HttpFetchError} on every failure except caller cancellation.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal,
    });
  } catch (cause) {
    // Caller cancellation is not an upstream failure — propagate as-is.
    if (options.signal?.aborted) throw cause;
    if (timeoutSignal.aborted) {
      throw new HttpFetchError(
        "timeout",
        `Request to ${url} timed out after ${options.timeoutMs}ms`,
        {
          cause,
        },
      );
    }
    throw new HttpFetchError("network", `Request to ${url} failed: ${describe(cause)}`, {
      cause,
    });
  }

  if (!response.ok) {
    throw new HttpFetchError("http", `Request to ${url} responded with ${response.status}`, {
      status: response.status,
    });
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new HttpFetchError("parse", `Response from ${url} was not valid JSON`, { cause });
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return String(cause);
}
