"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePreferencesStore } from "@/stores/preferencesStore";

/**
 * Settings → Playback → "Keep playing" (M10 task 5.1; spec `radio` — "Queue
 * autofill"; design §6).
 *
 * The one setting radio work introduced, and the whole of it: autofill spends
 * provider requests on the listener's behalf, so it has to be switchable. Radio
 * itself is **not** gated here — it only ever starts from an explicit
 * "Start … radio" gesture, so gating it would be a surprise rather than a
 * control (design §6).
 *
 * Follows the M8 Settings pattern exactly (see `LanguagesSettingsSection`):
 * the value is read from `preferencesStore`, the write is repository-first and
 * awaited, and the surface re-renders from the store rather than keeping its own
 * copy — so the toggle shows the effective value with no reload and cannot drift
 * from what the refill agent is reading.
 *
 * The control is a native checkbox inside a `<label>`, the same primitive
 * `LanguagePicker` uses, so it is keyboard-operable (Space toggles), announces
 * its own checked state, keeps the global `:focus-visible` ring, and needs no
 * ARIA of its own.
 *
 * Deliberately no live region and no alert at rest, so it never competes with
 * the Data controls' `role="status"` / `role="alert"` announcements on the same
 * page.
 */

const STORAGE_ERROR =
  "Spotivibe keeps this choice on this device only, but this browser is blocking storage.";

/** Accessible name of the one control, shared by the label and the tests. */
export const AUTOFILL_TOGGLE_LABEL = "Keep playing when the queue ends";

type SectionStatus = "loading" | "ready" | "error";

export function AutofillSettingsSection() {
  const autofillQueue = usePreferencesStore((state) => state.autofillQueue);
  const hydrate = usePreferencesStore((state) => state.hydrate);
  const setAutofillQueue = usePreferencesStore((state) => state.setAutofillQueue);
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [failure, setFailure] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Resolve one preferences read into the section status. Stable identity so the
  // mount effect depends on nothing but the store action.
  const settleRead = useCallback((read: Promise<void>): void => {
    read
      .then(() => {
        if (mountedRef.current) setStatus("ready");
      })
      .catch((error: unknown) => {
        console.warn("[preferences] settings hydration failed:", error);
        if (mountedRef.current) setStatus("error");
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    settleRead(hydrate());
    return () => {
      mountedRef.current = false;
    };
  }, [hydrate, settleRead]);

  async function toggle(enabled: boolean): Promise<void> {
    try {
      await setAutofillQueue(enabled);
      if (mountedRef.current) setFailure(null);
    } catch (error: unknown) {
      // Repository-first: the store never moved, so the checkbox is still
      // showing the stored value and only the explanation is new.
      console.warn("[preferences] autofill change failed:", error);
      if (mountedRef.current) {
        setFailure("Couldn't save that choice on this device. Your setting is unchanged.");
      }
    }
  }

  if (status === "error") {
    return (
      <p role="alert" className="text-body-lg text-pure-white">
        {STORAGE_ERROR}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="autofill-setting">
      <label className="flex cursor-pointer items-start gap-3 rounded-buttons px-2 py-2 hover:bg-smoke">
        <input
          type="checkbox"
          role="switch"
          className="mt-1 size-4 shrink-0 accent-spotify-green"
          checked={autofillQueue}
          disabled={status === "loading"}
          aria-label={AUTOFILL_TOGGLE_LABEL}
          onChange={(event) => {
            void toggle(event.target.checked);
          }}
        />
        <span className="min-w-0">
          <span className="block text-body-lg text-pure-white">{AUTOFILL_TOGGLE_LABEL}</span>
          <span className="block text-body text-mist">
            When an ordinary queue is about to end, Spotivibe adds a few more tracks so playback
            keeps going. Radio is always off until you start one.
          </span>
        </span>
      </label>
      {failure && (
        <p role="alert" className="px-2 text-body-lg text-pure-white">
          {failure}
        </p>
      )}
    </div>
  );
}
