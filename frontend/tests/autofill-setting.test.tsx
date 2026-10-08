import "fake-indexeddb/auto";
import { act, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/settings/page";
import { collectLocalData, serializeBackup } from "@/data/backup";
import { prepareImport } from "@/data/backup/prepare";
import { planMerge } from "@/data/backup/plan";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { DEFAULT_PREFERENCES } from "@/data/repositories";
import { startTrackRadio } from "@/features/personalization/startRadio";
import { AUTOFILL_TOGGLE_LABEL } from "@/features/preferences/AutofillSettingsSection";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";
import { encode } from "./helpers/backup-fixtures";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M10 task 5.1 (spec `radio` — "Queue autofill"; design §6): the `autofillQueue`
 * preference end to end, through the real (fake-indexeddb) preferences
 * repository.
 *
 * The four properties the task names, in the order they can break:
 *
 * 1. **The default is on.** A fresh install must read `true`, because autofill
 *    is the product's behavior, not an opt-in extra.
 * 2. **The Settings control toggles it** with the existing section pattern, and
 *    the control reflects the store rather than a local copy.
 * 3. **It persists through the existing repository** — the write lands before
 *    the UI moves, and a re-hydrate reads back what was stored.
 * 4. **It survives a backup round trip**, in both import modes, because a
 *    preference the exporter drops would silently reset itself on the next
 *    device.
 *
 * Radio itself is asserted *not* to be gated by this preference: design §6 gives
 * autofill a switch and radio none.
 */

// The full suite runs many jsdom workers in parallel; the first render has a cold
// React/fake-indexeddb start that can exceed the 1s default.
configure({ asyncUtilTimeout: 5000 });

let repositories: RepositorySet;

beforeEach(async () => {
  resetPreferencesStore();
  repositories = await getLocalData();
  await repositories.resetAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Render Settings and wait for the autofill control to be usable.
 *
 * **This used to wait for the wrong thing, and it failed a full gate batch because of it.**
 * Batch 31, run to try to certify M25, failed 1 of 6 here:
 *
 *     FAIL  the autofill preference's default > renders as enabled on a fresh Settings page
 *     AssertionError: expect(element).toBeEnabled()
 *     Received element is not enabled: <input … checked="" disabled="" … />
 *
 * The old wait was on `usePreferencesStore.getState().hydrated`, and that flag is a **necessary but
 * not sufficient** precondition for the assertion. `AutofillSettingsSection` disables its toggle on
 * a **local** `status === "loading"`, flipped only when *its own* `hydrate()` promise settles. One
 * promise chain, in order:
 *
 *   1. the read resolves;
 *   2. the store's `.then(applyPreferences)` sets `hydrated = true` — **observable from outside
 *      immediately**;
 *   3. the component's `.then(() => setStatus("ready"))` schedules a React render;
 *   4. React commits and the `disabled` attribute is removed — **observable only now**.
 *
 * So `hydrated` flips strictly *before* the DOM the test asserts on, with a state update and a
 * render commit in between. `waitFor` polls, and whether a poll lands before or after step 4 is a
 * scheduling question — which is why this reproduced in roughly **1 in 6 full-suite runs** and not
 * at all when the file runs alone.
 *
 * Waiting on the control itself removes the window by construction rather than narrowing it: there
 * is no second signal that can be observed early, so there is nothing left to lose. It is also
 * self-maintaining — if the component later gates `disabled` on something else, this follows the
 * assertion instead of silently drifting back to a stale proxy.
 *
 * The product is not at fault and is not changed. Disabling a control while its value is still
 * loading is correct.
 */
async function renderSettings(): Promise<ReturnType<typeof render>> {
  const view = render(<SettingsPage />);
  await waitFor(() => {
    expect(autofillToggle()).toBeEnabled();
  });
  return view;
}

function autofillToggle(): HTMLElement {
  return screen.getByRole("switch", { name: AUTOFILL_TOGGLE_LABEL });
}

describe("the autofill preference's default", () => {
  it("is on for a fresh install, in the type, the store, and the repository", async () => {
    expect(DEFAULT_PREFERENCES.autofillQueue).toBe(true);
    // Before hydration the store already reports the documented default, so a
    // surface can render the setting without waiting for storage.
    expect(usePreferencesStore.getState().autofillQueue).toBe(true);

    await usePreferencesStore.getState().hydrate();

    expect(usePreferencesStore.getState().autofillQueue).toBe(true);
    expect((await repositories.preferences.get()).autofillQueue).toBe(true);
  });

  it("renders as enabled on a fresh Settings page", async () => {
    await renderSettings();

    expect(autofillToggle()).toBeEnabled();
    expect(autofillToggle()).toBeChecked();
  });
});

describe("the autofill preference in Settings", () => {
  it("toggles off, writes through the repository, and shows the stored value", async () => {
    await renderSettings();

    fireEvent.click(autofillToggle());

    // Repository first: the state moves only once the device accepted the write.
    await waitFor(async () => {
      expect((await repositories.preferences.get()).autofillQueue).toBe(false);
    });
    expect(usePreferencesStore.getState().autofillQueue).toBe(false);
    await waitFor(() => expect(autofillToggle()).not.toBeChecked());

    // …and back on again, with no reload and no second control.
    fireEvent.click(autofillToggle());
    await waitFor(async () => {
      expect((await repositories.preferences.get()).autofillQueue).toBe(true);
    });
    expect(screen.getAllByRole("switch", { name: AUTOFILL_TOGGLE_LABEL })).toHaveLength(1);
  });

  it("survives a reload of the surface, because the store re-reads the repository", async () => {
    const first = await renderSettings();
    fireEvent.click(autofillToggle());
    await waitFor(async () => {
      expect((await repositories.preferences.get()).autofillQueue).toBe(false);
    });

    // A full remount is the closest a test gets to a reload: the fresh mount has
    // to re-read storage rather than inherit the previous mount's state.
    first.unmount();
    resetPreferencesStore();
    await renderSettings();

    expect(autofillToggle()).not.toBeChecked();
  });

  it("reports a failed write and leaves the stored value untouched", async () => {
    await renderSettings();
    const spy = vi
      .spyOn(repositories.preferences, "set")
      .mockRejectedValueOnce(new Error("write failed"));

    fireEvent.click(autofillToggle());

    expect(await screen.findByRole("alert")).toHaveTextContent(/unchanged/i);
    // The store never moved, so the control is still showing the stored value.
    expect(usePreferencesStore.getState().autofillQueue).toBe(true);
    spy.mockRestore();
    expect((await repositories.preferences.get()).autofillQueue).toBe(true);
  });
});

describe("the autofill preference and backups", () => {
  it("is exported by the preferences dataset", async () => {
    await usePreferencesStore.getState().setAutofillQueue(false);

    const exported = await collectLocalData(repositories);

    expect(exported.preferences.autofillQueue).toBe(false);
  });

  it("round-trips through a validated envelope in replace mode", async () => {
    await usePreferencesStore.getState().setAutofillQueue(false);
    const envelope = serializeBackup(await collectLocalData(repositories));

    // The envelope must survive the real import validation, not just the
    // exporter: a schema that rejected its own output would be worse than a
    // dropped field.
    const prepared = prepareImport(encode(envelope));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("envelope failed validation");
    expect(prepared.envelope.data.preferences.autofillQueue).toBe(false);

    // Replace writes the envelope's preferences verbatim.
    await repositories.resetAll();
    expect((await repositories.preferences.get()).autofillQueue).toBe(true);
    await repositories.preferences.set(prepared.envelope.data.preferences);
    expect((await repositories.preferences.get()).autofillQueue).toBe(false);
  });

  it("round-trips through the real merge planner, whose comparison covers the field", async () => {
    await usePreferencesStore.getState().setAutofillQueue(false);
    const envelope = serializeBackup(await collectLocalData(repositories));

    // Local state agrees on everything *except* autofill: merge suppresses the
    // whole preferences write when it decides nothing changed, so a field
    // missing from that comparison would drop the setting here.
    await repositories.preferences.set({
      languages: ["hi"],
      autoplayNext: true,
      reduceMotion: false,
      onboardingComplete: true,
      autofillQueue: true,
    });
    const local = await collectLocalData(repositories);

    const plan = planMerge(envelope, local);

    expect(plan.stats.preferences).toBe(1);
    expect(plan.writes.preferences?.autofillQueue).toBe(false);
    await repositories.preferences.set(plan.writes.preferences ?? {});
    expect((await repositories.preferences.get()).autofillQueue).toBe(false);
  });

  it("defaults a pre-M10 envelope that predates the field, rather than failing it", async () => {
    // The additive case that matters for a real user: a v1 backup written before
    // autofill existed carries no such key and must still import, with the
    // default the user would have had.
    const envelope = serializeBackup(await collectLocalData(repositories));
    const legacy = encode({
      ...envelope,
      data: {
        ...envelope.data,
        preferences: {
          languages: ["hi"],
          autoplayNext: true,
          reduceMotion: false,
          onboardingComplete: true,
        },
      },
    });

    const prepared = prepareImport(legacy);

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("a pre-M10 envelope should still validate");
    expect(prepared.envelope.data.preferences.autofillQueue).toBe(true);
  });
});

describe("what the preference does not gate", () => {
  it("leaves a radio start independent of the setting", async () => {
    // Design §6: autofill spends provider requests on the user's behalf so it is
    // switchable; a radio only ever starts from an explicit gesture, so gating
    // it would be a surprise. Turning the setting off must not disable a radio
    // the user asked for.
    await usePreferencesStore.getState().setAutofillQueue(false);

    const seed = makeTrack({ id: "youtube:seed", providerId: "seed", title: "Get Lucky" });
    const radioTracks = [makeTrack({ id: "youtube:r1", providerId: "r1", title: "Radio One" })];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ tracks: radioTracks, variant: 0 }),
          }) as unknown as Response,
      ),
    );

    const outcome = await startTrackRadio(seed);

    expect(outcome.status).toBe("started");
    vi.unstubAllGlobals();
    expect(usePreferencesStore.getState().autofillQueue).toBe(false);
  });
});

describe("clearing local data changes the preference (spec: clearing changes personalization)", () => {
  it("returns to the default after the stored record is cleared, with no stale copy", async () => {
    await usePreferencesStore.getState().setAutofillQueue(false);
    expect(usePreferencesStore.getState().autofillQueue).toBe(false);

    await act(async () => {
      await repositories.resetAll();
      await usePreferencesStore.getState().hydrate();
    });

    // Nothing caches the setting, so a clear is the whole invalidation.
    expect(usePreferencesStore.getState().autofillQueue).toBe(true);
  });
});
