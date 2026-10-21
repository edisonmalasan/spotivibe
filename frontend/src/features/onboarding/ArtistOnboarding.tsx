"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/design-system/IconButton";
import { ArtistCard } from "@/components/design-system/ArtistCard";
import { Skeleton } from "@/components/design-system/Skeleton";
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
 *
 * ## Three states, and only two of them are answers
 *
 * A dismissal is an answer: `markOnboardingSeen()` is called on dismissal, on
 * purpose, because re-asking someone who has already answered is nagging. So a
 * surface that says "there are no artists" *before* the rail has asked is
 * collecting an answer to a question it never asked — and that was exactly what
 * happened, because the rail's entries arrive asynchronously and the first
 * render always carried an empty list.
 *
 * | State | What it shows | Dismissible? |
 * |---|---|---|
 * | `pending` | the rail has not settled | **No** |
 * | `offering` | the artist grid | Yes |
 * | `nothing` | the settled-and-empty case, and where to choose later | Yes |
 *
 * `pending` offers **no dismissal control at all** — not a disabled one. A
 * control that looks available and is not is worse than its absence.
 *
 * `pending` is also **time-bounded** (design limit D7). A provider request that
 * never settles would otherwise leave a listener who cannot leave, and a
 * surface that will not let someone leave is worse than the defect this
 * surface fixes. After the bound the surface proceeds to `nothing` and offers
 * the dismissal.
 */

export const ARTIST_ONBOARDING_LABEL = "Pick artists you like";
export const ARTIST_ONBOARDING_TITLE = "Welcome to Spotivibe";

/**
 * How long the surface waits for the rail before it stops waiting.
 *
 * Bounded on purpose. The value is a *bound*, not a target: the surface
 * proceeds to the settled-and-empty state when it expires, so a listener is
 * never held. Exported so the test that proves the bound exists asserts the
 * real number rather than a copy of it.
 */
export const ARTIST_ONBOARDING_PENDING_TIMEOUT_MS = 8_000;

/**
 * The settled-and-empty copy.
 *
 * It names the place where artists can be chosen later, because "You can pick
 * them later" is only true when there is a later — and there is now: Settings
 * carries the same picker, and the empty rail offers it too.
 */
export const ARTIST_ONBOARDING_EMPTY =
  "We couldn't find any artists yet. You can pick them in Settings, under Artists.";

/**
 * The copy for a surface that stopped waiting for the rail.
 *
 * Deliberately **not** the empty copy: the rail never settled, so "we couldn't
 * find any artists" would be a claim this surface cannot make. What it can say
 * is that the artists did not arrive — and that the listener may leave.
 */
export const ARTIST_ONBOARDING_UNRESOLVED =
  "We couldn't load artists yet. You can pick them in Settings, under Artists.";

/** The three states the surface can be in. */
export type ArtistOnboardingPhase = "pending" | "offering" | "nothing";

export interface ArtistOnboardingProps {
  /** The artists offered for selection — the Quick Picks rail's own entries. */
  artists: readonly QuickPick[];
  /**
   * Whether the rail has settled.
   *
   * The surface cannot tell an empty rail that has decided to hold nothing from
   * one that has not decided yet, and the difference decides whether it may
   * claim there are no artists and whether it may offer a dismissal.
   */
  settled: boolean;
  onClose(): void;
  /**
   * The heading, for a host that is not a first run.
   *
   * The Settings re-entry opens this same surface, and a listener who has been
   * using the app for a week should not be greeted as a new one.
   */
  heading?: string;
}

export function ArtistOnboarding({
  artists,
  settled,
  onClose,
  heading = ARTIST_ONBOARDING_TITLE,
}: ArtistOnboardingProps) {
  const confirm = useQuickPickPicksStore((state) => state.confirm);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * Whether the surface gave up waiting for the rail.
   *
   * Set by a timer rather than by the rail, because the rail is the thing that
   * might never answer.
   */
  const [timedOut, setTimedOut] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Set on dismissal so a late write never updates an unmounted dialog. */
  const dismissedRef = useRef(false);

  /*
   * The pending state has a bound.
   *
   * The rail settles when the provider settles and the local stores have
   * hydrated — and a provider request that hangs would otherwise hold a
   * surface that offers no way out. When the bound expires the surface stops
   * waiting and becomes dismissible.
   */
  useEffect(() => {
    if (settled) return;
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, ARTIST_ONBOARDING_PENDING_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [settled]);

  /*
   * The phase, and therefore whether this surface may be dismissed at all.
   *
   * `settled` decides between "offering"/"nothing" and "pending"; the timeout
   * is what stops "pending" from being permanent. A rail that settles *after*
   * the bound has expired still wins: the surface then shows the truth.
   */
  const phase: ArtistOnboardingPhase = settled
    ? artists.length > 0
      ? "offering"
      : "nothing"
    : timedOut
      ? "nothing"
      : "pending";

  /** Only a surface whose answer is true may be dismissed. */
  const dismissible = phase !== "pending";

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      dismissedRef.current = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (!dismissible) return;
    dismissedRef.current = true;
    // A dismissal counts as completing first run. Re-asking someone who has
    // already answered — or who chose to skip — is nagging, not onboarding.
    markOnboardingSeen();
    onClose();
  }, [dismissible, onClose]);

  useEffect(() => {
    // No Escape dismissal while the question has not been asked: the surface
    // would be collecting an answer it never posed.
    if (!dismissible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        dismiss();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismiss, dismissible]);

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
            <h2 className="text-link font-bold text-pure-white">{heading}</h2>
            <p className="text-body text-mist">
              Pick a few artists you like. They lead your Quick Picks. Everything stays on this
              device.
            </p>
          </div>
          {/*
           * The close control is part of the dismissal, so it is part of what
           * `pending` withholds: a control that looks available and is not is
           * worse than its absence.
           */}
          {dismissible && (
            <IconButton label="Close" onClick={dismiss}>
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          )}
        </div>

        {/* Nothing to pick from yet: an empty rail must not render an empty grid
            of controls, or a "done" button that stores nothing. */}
        {phase === "pending" && (
          /*
           * The rail has not settled, so this surface does not yet know whether
           * there are any artists. It says so, and it offers no way out: a
           * dismissal here would be an answer to a question that has not been
           * asked.
           */
          <div
            aria-busy="true"
            data-testid="artist-onboarding-pending"
            className="flex flex-col gap-3"
          >
            <p className="text-body text-mist">Looking for artists…</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} variant="circle" className="w-full" />
              ))}
            </div>
          </div>
        )}

        {phase === "nothing" && (
          /*
           * The settled-and-empty case, or the surface that stopped waiting.
           * Either way it says what it knows and points at the place where
           * artists can be chosen — a place that now exists.
           */
          <div data-testid="artist-onboarding-empty" className="flex flex-col gap-3">
            <p className="text-body text-mist">
              {settled ? ARTIST_ONBOARDING_EMPTY : ARTIST_ONBOARDING_UNRESOLVED}
            </p>
            <Link
              href="/settings"
              className="self-start rounded-buttons px-4 py-2 text-body-lg font-bold text-mist hover:text-pure-white"
            >
              Open Settings
            </Link>
          </div>
        )}

        {phase === "offering" && (
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
