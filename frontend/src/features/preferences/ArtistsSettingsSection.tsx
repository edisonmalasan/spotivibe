"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/design-system/Button";
import { useDiscoveryShelf } from "@/features/home/useDiscoveryShelf";
import { toProviderShelfState, useQuickPickArtists } from "@/features/home/useQuickPickArtists";
import { ArtistOnboarding } from "@/features/onboarding/ArtistOnboarding";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useQuickPickPicksStore } from "@/stores/quickPickPicksStore";

/**
 * Settings → Artists (spec: `home-mixes` — "First run asks for artists, not
 * languages"; design decision D4).
 *
 * The direct analogue of `LanguagesSettingsSection`, which reopens the shared
 * `LanguagePicker`: a first-run answer that cannot be revised is a decision
 * rather than a question, so the same question is asked again here — on demand,
 * never unprompted. The first-run surface still does not re-present itself; this
 * is a *place*, not a pop-up.
 *
 * **The artists are the rail's own artists.** The list comes from
 * `useQuickPickArtists`, the same hook the rail and the first-run surface read,
 * so "the same artists" is true by construction rather than by two call sites
 * agreeing (D1).
 *
 * **This surface has its own provider feed**, which is a real cost and a
 * recorded one (D1.1, D4, D7): the rail's cold-start stand-in is the provider
 * results the caller already holds, and only a surface that fetched a discovery
 * feed knows what its own feed fetched. The alternative — a Settings surface
 * that can only show the artists it already knows — would make the re-entry
 * useless for exactly the listeners who need it, which are the ones with no
 * local material.
 *
 * The feed is **enabled only while the picker is open**, so the cost is paid
 * by the listener who asks for the artists rather than by every visit to
 * Settings.
 */
export function ArtistsSettingsSection() {
  const picks = useQuickPickPicksStore((state) => state.picks);
  const picksHydrated = useQuickPickPicksStore((state) => state.hydrated);
  const languages = usePreferencesStore((state) => state.languages);
  const [open, setOpen] = useState(false);

  /*
   * The provider feed, gated on the picker being open.
   *
   * `useDiscoveryShelf`'s own `enabled` gate is what makes this lazy: a
   * disabled shelf issues no request and reports `"idle"`, so visiting Settings
   * costs nothing and opening the picker costs the two feeds the rail reads.
   */
  const trending = useDiscoveryShelf({ kind: "trending", languages, enabled: open });
  const collections = useDiscoveryShelf({ kind: "collection", languages, enabled: open });

  // The same two sources the Home feed hands to the rail, in the same order.
  const providerTracks = useMemo(
    () => [...trending.tracks, ...collections.tracks],
    [collections.tracks, trending.tracks],
  );

  const { artists, settled } = useQuickPickArtists({
    providerTracks,
    providerState: toProviderShelfState(trending.status),
  });

  const loading = !picksHydrated;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p data-testid="artists-summary" className="text-body-lg text-mist">
          {loading
            ? "Reading your saved artists…"
            : picks.length === 0
              ? "No artists picked yet."
              : `Picked: ${picks.map((pick) => pick.name).join(", ")}.`}
        </p>
        {open ? (
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            Close
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(true);
            }}
            disabled={loading}
          >
            Choose artists
          </Button>
        )}
      </div>

      {open && (
        /*
         * The same surface the first run presents, opened on demand.
         *
         * It is the same component rather than a second one, so the artists
         * offered, the way they are written, and the way they are stored cannot
         * drift apart. The heading differs only because a listener who has been
         * using the app for a week should not be greeted as a new one.
         */
        <ArtistOnboarding
          artists={artists}
          settled={settled}
          heading="Choose artists"
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
