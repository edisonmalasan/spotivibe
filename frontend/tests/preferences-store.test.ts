import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { DEFAULT_PREFERENCES } from "@/data/repositories";
import { DEFAULT_LANGUAGE, LANGUAGES, MAX_SELECTED_LANGUAGES } from "@/lib/languages";
import {
  initialPreferencesState,
  resetPreferencesStore,
  usePreferencesStore,
} from "@/stores/preferencesStore";

/**
 * M8 task 3.2: `preferencesStore` over the existing preferences repository —
 * hydrate idempotence, the effective-selection guarantee (state always carries
 * at least one catalog code so a discovery request is always valid), and the
 * repository-first round trip for `setLanguages` / `completeOnboarding`.
 */

let repositories: RepositorySet;

beforeEach(async () => {
  resetPreferencesStore();
  repositories = await getLocalData();
  await repositories.resetAll();
});

describe("preferencesStore hydration", () => {
  it("starts unhydrated and reports the effective default selection", () => {
    const state = usePreferencesStore.getState();
    expect(state.hydrated).toBe(false);
    expect(state.languages).toEqual([DEFAULT_LANGUAGE]);
    expect(state.onboardingComplete).toBe(DEFAULT_PREFERENCES.onboardingComplete);
    expect(state.autoplayNext).toBe(DEFAULT_PREFERENCES.autoplayNext);
    expect(state.reduceMotion).toBe(DEFAULT_PREFERENCES.reduceMotion);
  });

  it("reads stored preferences from the repository", async () => {
    await repositories.preferences.set({
      languages: ["ja", "es"],
      autoplayNext: false,
      reduceMotion: true,
      onboardingComplete: true,
    });

    await usePreferencesStore.getState().hydrate();

    const state = usePreferencesStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.languages).toEqual(["ja", "es"]);
    expect(state.onboardingComplete).toBe(true);
    expect(state.autoplayNext).toBe(false);
    expect(state.reduceMotion).toBe(true);
  });

  it("falls back to the default language when nothing is stored yet", async () => {
    await usePreferencesStore.getState().hydrate();

    // The repository still holds an empty list; state carries the effective one.
    expect((await repositories.preferences.get()).languages).toEqual([]);
    expect(usePreferencesStore.getState().languages).toEqual([DEFAULT_LANGUAGE]);
    expect(usePreferencesStore.getState().hydrated).toBe(true);
  });

  it("drops unknown and duplicate stored codes and caps the selection", async () => {
    await repositories.preferences.set({
      languages: [
        "klingon",
        "en",
        "en",
        ...LANGUAGES.map((language) => language.code).slice(0, MAX_SELECTED_LANGUAGES),
      ],
    });

    await usePreferencesStore.getState().hydrate();

    const codes = usePreferencesStore.getState().languages;
    expect(codes).toHaveLength(MAX_SELECTED_LANGUAGES);
    expect(codes[0]).toBe("en");
    expect(codes).not.toContain("klingon");
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("is idempotent: concurrent and repeated hydration never appends or duplicates", async () => {
    await repositories.preferences.set({ languages: ["fr"] });
    const store = usePreferencesStore.getState();

    await Promise.all([store.hydrate(), store.hydrate()]); // one shared read
    await store.hydrate(); // and a later call re-reads, never appends

    expect(usePreferencesStore.getState().languages).toEqual(["fr"]);
    expect(usePreferencesStore.getState().hydrated).toBe(true);
  });

  it("resyncs after a bulk reset + hydrate (Settings reset / backup import)", async () => {
    await repositories.preferences.set({ languages: ["hi"], onboardingComplete: true });
    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().languages).toEqual(["hi"]);

    await repositories.resetAll();
    await usePreferencesStore.getState().hydrate();

    expect(usePreferencesStore.getState().languages).toEqual([DEFAULT_LANGUAGE]);
    expect(usePreferencesStore.getState().onboardingComplete).toBe(false);
  });

  it("resetPreferencesStore returns the store to its initial state", async () => {
    await repositories.preferences.set({ languages: ["ko"], onboardingComplete: true });
    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().hydrated).toBe(true);

    resetPreferencesStore();

    const state = usePreferencesStore.getState();
    expect(state.hydrated).toBe(false);
    expect(state.languages).toEqual(initialPreferencesState.languages);
    expect(state.onboardingComplete).toBe(false);
  });
});

describe("preferencesStore writes", () => {
  it("persists a language selection through the repository and reflects it", async () => {
    await usePreferencesStore.getState().setLanguages(["es", "ja"]);

    expect((await repositories.preferences.get()).languages).toEqual(["es", "ja"]);
    expect(usePreferencesStore.getState().languages).toEqual(["es", "ja"]);
    expect(usePreferencesStore.getState().hydrated).toBe(true);
    // A plain language change must not fake onboarding completion.
    expect((await repositories.preferences.get()).onboardingComplete).toBe(false);
  });

  it("normalizes the selection it persists", async () => {
    await usePreferencesStore.getState().setLanguages(["klingon", "de", "de", "  fr  "]);

    expect((await repositories.preferences.get()).languages).toEqual(["de", "fr"]);
    expect(usePreferencesStore.getState().languages).toEqual(["de", "fr"]);
  });

  it("persists the effective default when the selection would be empty", async () => {
    await usePreferencesStore.getState().setLanguages([]);

    expect((await repositories.preferences.get()).languages).toEqual([DEFAULT_LANGUAGE]);
    expect(usePreferencesStore.getState().languages).toEqual([DEFAULT_LANGUAGE]);
  });

  it("completes onboarding with the languages in one write and survives a re-hydrate", async () => {
    await usePreferencesStore.getState().completeOnboarding(["hi", "en"]);

    const stored = await repositories.preferences.get();
    expect(stored).toMatchObject({ languages: ["hi", "en"], onboardingComplete: true });
    // The write is a patch: the untouched toggles keep their stored values.
    expect(stored.autoplayNext).toBe(DEFAULT_PREFERENCES.autoplayNext);

    resetPreferencesStore();
    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().languages).toEqual(["hi", "en"]);
    expect(usePreferencesStore.getState().onboardingComplete).toBe(true);
  });

  it("keeps unrelated preferences when languages change", async () => {
    await repositories.preferences.set({ autoplayNext: false, reduceMotion: true });

    await usePreferencesStore.getState().setLanguages(["ta"]);

    const stored = await repositories.preferences.get();
    expect(stored).toMatchObject({ languages: ["ta"], autoplayNext: false, reduceMotion: true });
  });

  it("leaves state and storage unchanged when the write fails", async () => {
    await usePreferencesStore.getState().setLanguages(["it"]);
    const before = usePreferencesStore.getState().languages;

    const spy = vi
      .spyOn(repositories.preferences, "set")
      .mockRejectedValueOnce(new Error("write failed"));

    await expect(usePreferencesStore.getState().setLanguages(["sv"])).rejects.toThrow(
      "write failed",
    );
    spy.mockRestore();

    expect(usePreferencesStore.getState().languages).toEqual(before);
    expect((await repositories.preferences.get()).languages).toEqual(["it"]);
  });
});
