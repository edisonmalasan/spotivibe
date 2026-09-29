"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/design-system/IconButton";
import { LanguagePicker } from "@/features/preferences/LanguagePicker";
import { usePreferencesStore } from "@/stores/preferencesStore";

/**
 * `LanguageOnboarding` (ROADMAP M8, spec: language catalog and first-run
 * onboarding): the first-run dialog Home mounts while `onboardingComplete` is
 * false. It wraps the reusable `LanguagePicker` and follows the M7 dialog a11y
 * contract by convention — `role="dialog"` + `aria-modal` + `aria-label`, focus
 * enters on mount, Escape/backdrop/Close dismiss, and the opener owns focus
 * return.
 *
 * Dismissing leaves the repository untouched, so the choice is offered again on
 * the next visit (the spec asks for an explicit, dismissible *or* confirmable
 * choice, never a forced account step). Confirming persists the selection and
 * the completed flag in one repository write through `preferencesStore`; a
 * failed write is reported and the dialog stays open so the user can retry.
 *
 * There is no account, sign-in, or email copy in this surface.
 */

/** Accessible name of the dialog surface. */
export const LANGUAGE_ONBOARDING_LABEL = "Choose your languages";

/** Headline above the picker. */
export const LANGUAGE_ONBOARDING_TITLE = "Welcome to Spotivibe";

export interface LanguageOnboardingProps {
  /** Dismissal — the opener decides where focus returns. */
  onClose(): void;
}

export function LanguageOnboarding({ onClose }: LanguageOnboardingProps) {
  const languages = usePreferencesStore((state) => state.languages);
  const completeOnboarding = usePreferencesStore((state) => state.completeOnboarding);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Set on dismissal so a late write never updates the unmounted dialog. */
  const dismissedRef = useRef(false);

  // Focus starts inside the dialog so keyboard users land in the surface they
  // opened; dismissal returns focus to the trigger (opener-owned).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      dismissedRef.current = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    onClose();
  }, [onClose]);

  // Escape dismisses wherever focus currently is (option, button, or dialog).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        dismiss();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  async function confirm(codes: string[]): Promise<void> {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    try {
      await completeOnboarding(codes);
    } catch (error: unknown) {
      console.warn("[preferences] language onboarding write failed:", error);
      if (!dismissedRef.current) {
        setFailure("Couldn't save your languages on this device. Please try again.");
      }
      setSaving(false);
      return;
    }
    if (dismissedRef.current) return;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-void-black/70 p-4"
      onMouseDown={dismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={LANGUAGE_ONBOARDING_LABEL}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-y-auto rounded-cards bg-carbon p-5 outline-none"
        onMouseDown={(event) => event.stopPropagation()} // backdrop only dismisses
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-link font-bold text-pure-white">{LANGUAGE_ONBOARDING_TITLE}</h2>
            <p className="text-body text-mist">
              Pick the languages you want in your feeds. Everything stays on this device.
            </p>
          </div>
          <IconButton label="Close" onClick={dismiss}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </div>

        <LanguagePicker
          initialCodes={languages}
          confirmLabel="Save languages"
          saving={saving}
          onConfirm={(codes) => {
            void confirm(codes);
          }}
        />

        {failure && (
          <p role="alert" className="mt-3 text-body text-pure-white">
            {failure}
          </p>
        )}
      </div>
    </div>
  );
}
