import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { YtNamespace } from "@/player/types";

const API_SRC = "https://www.youtube.com/iframe_api";

/**
 * Fresh module state per test: the loader's once-guard is module-level, so
 * each case re-imports the module after `vi.resetModules()`.
 */
async function freshLoader(): Promise<typeof import("@/player/ytApi").loadYouTubeIframeApi> {
  vi.resetModules();
  return (await import("@/player/ytApi")).loadYouTubeIframeApi;
}

function apiScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll(`script[src="${API_SRC}"]`));
}

function fakePlayerCtor(): YtNamespace["Player"] {
  return class {} as unknown as YtNamespace["Player"];
}

describe("loadYouTubeIframeApi", () => {
  beforeEach(() => {
    delete window.YT;
    delete window.onYouTubeIframeAPIReady;
    apiScripts().forEach((tag) => tag.remove());
  });

  afterEach(() => {
    delete window.YT;
    delete window.onYouTubeIframeAPIReady;
  });

  it("injects exactly one script and shares one promise under concurrent calls", async () => {
    const load = await freshLoader();

    const first = load();
    const second = load();

    expect(second).toBe(first);
    expect(apiScripts()).toHaveLength(1);

    window.YT = { Player: fakePlayerCtor() };
    window.onYouTubeIframeAPIReady?.();

    await expect(first).resolves.toBe(window.YT);
    expect(apiScripts()).toHaveLength(1); // still exactly one after resolution
  });

  it("resolves without injecting a script when the API is already present", async () => {
    const load = await freshLoader();
    window.YT = { Player: fakePlayerCtor() };

    await expect(load()).resolves.toBe(window.YT);
    expect(apiScripts()).toHaveLength(0);
  });

  it("chains a pre-existing onYouTubeIframeAPIReady handler", async () => {
    const load = await freshLoader();
    const previous = vi.fn();
    window.onYouTubeIframeAPIReady = previous;

    const promise = load();
    window.YT = { Player: fakePlayerCtor() };
    window.onYouTubeIframeAPIReady?.();

    expect(previous).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toBe(window.YT);
  });

  it("rejects on a script error and allows a clean retry afterwards", async () => {
    const load = await freshLoader();

    const failed = load();
    apiScripts()[0].onerror?.(new Event("error"));

    await expect(failed).rejects.toThrow("Failed to load the YouTube IFrame API.");
    expect(apiScripts()).toHaveLength(0); // rejected tag removed, not left behind

    const retry = load();
    expect(retry).not.toBe(failed);
    expect(apiScripts()).toHaveLength(1); // fresh injection on retry

    window.YT = { Player: fakePlayerCtor() };
    window.onYouTubeIframeAPIReady?.();
    await expect(retry).resolves.toBe(window.YT);
  });
});
