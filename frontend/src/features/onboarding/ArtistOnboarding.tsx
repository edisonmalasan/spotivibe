"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/design-system/IconButton";
import { ArtistCard } from "@/components/design-system/ArtistCard";
import type { QuickPick } from "@/features/home/quickPicks";
import { markOnboardingSeen } from "@/features/onboarding/onboardingGate";
import { useQuickPickPicksStore } from "@/stores/quickPickPicksStore";

/**
 * First-run artist onboarding.
 *
 * Replaces the first-run *language* dialog. The language preference is unchanged
 * and still editable in Settings — what changed is which question the app asks
 * first. Languages filter a catalog; taste is the input the app cannot infer on
 * a brand-new device, and asking for languages first meant the dashboard sat
 * behind a dialog before anyone had stated a preference at all.
 *
 * **The accessibility contract is inherited from the surface it replaces**, not
 * dropped with it: `role="dialog"`, `aria-modal`, a label, focus on mount,
 * Escape and backdrop dismissal, and focus returning to whoever opened it. What
 * is new is `aria-pressed` on each artist toggle, because selection that is
 * conveyed by a ring colour alone is not selection a screen reader can report.
 */

export const ARTIST_ONBOARDING_LABEL = "Pick artists you like";
export const ARTIST_ONBOARDING_TITLE = "Welcome to Spotivibe";

export interface ArtistOnboardingProps {
  /** The artists offered for selection — the Quick Picks rail's own entries. */
  artists: readonly QuickPick[];
  onClose(): void;
}

export function ArtistOnboarding({ artists, onClose }: ArtistOnboardingProps) {
  const confirm = useQuickPickPicksStore((state) => state.confirm);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Set on dismissal so a late write never updates an unmounted dialog. */
  const dismissedRef = useRef(false);

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
    // A dismissal counts as completing first run. Re-asking someone who has
    // already answered — or who chose to skip — is nagging, not onboarding.
    markOnboardingSeen();
    onClose();
  }, [onClose]);

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

  const toggle = useCallback((artistId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(artistId)) next.delete(artistId);
      else next.add(artistId);
      return next;
    });
  }, []);

  async function finish(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const chosen = artists.filter((artist) => selected.has(artist.target));
    const names = new Map(chosen.map((artist) => [artist.target, artist.title]));
    try {
      await confirm(
        chosen.map((artist) => artist.target),
        names,
      );
    } catch (error: unknown) {
      // The dialog stays open on a failed write: telling someone their picks
      // were saved when they were not is the worst outcome available here.
      console.warn("[onboarding] artist picks write failed:", error);
      if (!dismissedRef.current) {
        setFailure("Couldn't save your picks on this device. Please try again.");
      }
      setSaving(false);
      return;
    }
    if (dismissedRef.current) return;
    markOnboardingSeen();
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
        aria-label={ARTIST_ONBOARDING_LABEL}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-y-auto rounded-cards bg-carbon p-5 outline-none"
        onMouseDown={(event) => event.stopPropagation()} // backdrop only dismisses
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-link font-bold text-pure-white">{ARTIST_ONBOARDING_TITLE}</h2>
            <p className="text-body text-mist">
              Pick a few artists you like. They lead your Quick Picks. Everything stays on this
              device.
            </p>
          </div>
          <IconButton label="Close" onClick={dismiss}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </div>

        {/* Nothing to pick from yet: an empty rail must not render an empty grid
            of controls, or a "done" button that stores nothing. */}
        {artists.length === 0 ? (
          <p className="text-body text-mist">
            We couldn&apos;t find any artists yet. You can pick them later.
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {artists.map((artist) => {
                const isSelected = selected.has(artist.target);
                return (
                  <li key={artist.id}>
                    {/*
                     * A button wrapping the shared `ArtistCard`, rather than a
                     * hand-rolled circle: the card is DESIGN.md's circular artist
                     * tile and already owns the 1:1 ratio, the placeholder glyph and
                     * the artwork `<img>` lint exemption. Re-deriving it here
                     * produced a second, differently-proportioned artist image and a
                     * `@next/next/no-img-element` error — both fixed by using the
                     * one component the rest of the app already uses.
                     *
                     * **No motion class on this button, deliberately.** `MOTION_ALLOWED`
                     * is a closed list of modules and this one is not on it, so a
                     * `motion-feedback` here fails `motion-scope`'s "nothing outside
                     * the named surfaces may animate". It would also be redundant: the
                     * `ArtistCard` inside already carries `motion-reveal` and
                     * `motion-feedback`, which is where the roadmap's "entrance" and
                     * "feedback" surfaces are actually spent. Selection is announced
                     * by `aria-pressed` and by the ring, not by an animation — which is
                     * also why this dialog inherited no allowance when it replaced
                     * `LanguageOnboarding`, which had none either.
                     */}
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => {
                        toggle(artist.target);
                      }}
                      className={`w-full rounded-cards ${
                        isSelected ? "ring-2 ring-pure-white" : "ring-transparent"
                      }`}
                    >
                      <ArtistCard
                        name={artist.title}
                        artworkUrl={artist.artworkUrl}
                        className="p-1"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>

            {failure && (
              <p role="alert" className="mt-3 text-body text-pure-white">
                {failure}
              </p>
            )}

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  void finish();
                }}
                disabled={saving}
                className="rounded-full bg-pure-white px-5 py-2 font-bold text-carbon disabled:opacity-60"
              >
                {saving ? "Saving…" : "Start listening"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
