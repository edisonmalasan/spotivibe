import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/server/http/fetchJson";

/** Minimal Response-like object for mocked `fetch`. */
function jsonResponse(data: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => data,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("returns parsed JSON on a 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ tracks: [] })),
    );
    await expect(fetchJson("https://example.test/api", { timeoutMs: 1000 })).resolves.toEqual({
      tracks: [],
    });
  });

  it("fails with kind http and the status on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, { ok: false, status: 503 })),
    );
    await expect(fetchJson("https://example.test/api", { timeoutMs: 1000 })).rejects.toMatchObject({
      name: "HttpFetchError",
      kind: "http",
      status: 503,
    });
  });

  it("fails with kind parse on an invalid JSON body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected token < in JSON");
            },
          }) as unknown as Response,
      ),
    );
    await expect(fetchJson("https://example.test/api", { timeoutMs: 1000 })).rejects.toMatchObject({
      name: "HttpFetchError",
      kind: "parse",
    });
  });

  it("fails with kind network when fetch itself rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(fetchJson("https://example.test/api", { timeoutMs: 1000 })).rejects.toMatchObject({
      name: "HttpFetchError",
      kind: "network",
    });
  });

  it("aborts a hung upstream with kind timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );
    await expect(fetchJson("https://example.test/hang", { timeoutMs: 25 })).rejects.toMatchObject({
      name: "HttpFetchError",
      kind: "timeout",
    });
  });

  it("propagates caller cancellation as the original AbortError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );
    const controller = new AbortController();
    const pending = fetchJson("https://example.test/slow", {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toSatisfy(
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
  });

  it("hands the composed signal to fetch so both abort paths are live", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await fetchJson("https://example.test/api", { timeoutMs: 1000, signal: controller.signal });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
    expect(calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
