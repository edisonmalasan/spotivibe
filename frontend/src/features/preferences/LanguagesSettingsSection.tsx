"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/design-system/Button";
import { ErrorState } from "@/components/design-system/ErrorState";
import { LanguagePicker } from "@/features/preferences/LanguagePicker";
import { languageName } from "@/lib/languages";
import { usePreferencesStore } from "@/stores/preferencesStore";

/**
 * Settings → Languages (ROADMAP M8, spec: languages are changeable after
 * onboarding): names the current selection and reopens the shared
 * `LanguagePicker` to change it. Confirming persists through
 * `preferencesStore.setLanguages` — the same repository write first-run
 * onboarding uses, so a change survives reload exactly like the first choice.
 *
 * One local `status` drives the whole surface, so the summary can never show a
 * hydrated selection while the control beside it is still disabled.
 *
 * The resting state renders no live region and no alert, so it never competes
 * with the Data controls' own `role="status"` / `role="alert"` announcements on
 * the same page.
 */

const STORAGE_ERROR =
  "Spotivibe keeps your languages on this device only, but this browser is blocking storage.";

type SectionStatus = "loading" | "ready" | "error";

export function LanguagesSettingsSection() {
  const languages = usePreferencesStore((state) => state.languages);
  const hydrate = usePreferencesStore((state) => state.hydrate);
  const setLanguages = usePreferencesStore((state) => state.setLanguages);
  const [status, setStatus] = useState<SectionStatus>("loading");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Resolve one preferences read into the section status. Stable identity so
  // the mount effect depends on nothing but the store action.
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

  function handleRetry(): void {
    setStatus("loading");
    settleRead(hydrate());
  }

  async function confirm(codes: string[]): Promise<void> {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    try {
      await setLanguages(codes);
    } catch (error: unknown) {
      console.warn("[preferences] language change failed:", error);
      if (mountedRef.current) {
        setFailure("Couldn't save your languages on this device. Your selection is unchanged.");
      }
      setSaving(false);
      return;
    }
    if (!mountedRef.current) return;
    setSaving(false);
    setEditing(false);
  }

  if (status === "error") {
    return (
      <ErrorState
        title="Languages are unavailable"
        description={STORAGE_ERROR}
        retryLabel="Try again"
        onRetry={handleRetry}
      />
    );
  }

  const loading = status === "loading";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p data-testid="languages-summary" className="text-body-lg text-mist">
          {loading
            ? "Reading your saved languages…"
            : `Showing ${languages.map((code) => languageName(code)).join(", ")}.`}
        </p>
        {editing ? (
          <Button
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setFailure(null);
            }}
            disabled={saving}
          >
            Cancel
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setEditing(true)} disabled={loading}>
            Change languages
          </Button>
        )}
      </div>

      {editing && (
        <LanguagePicker
          // The picker is conditionally rendered, so each open starts a fresh
          // draft from the saved selection (a cancel discards the draft).
          initialCodes={languages}
          confirmLabel="Save languages"
          saving={saving}
          onConfirm={(codes) => {
            void confirm(codes);
          }}
        />
      )}

      {failure && (
        <p role="alert" className="text-body-lg text-pure-white">
          {failure}
        </p>
      )}
    </div>
  );
}
