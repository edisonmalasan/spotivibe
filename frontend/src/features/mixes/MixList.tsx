"use client";

import { Play, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/design-system/Button";
import { EmptyState } from "@/components/design-system/EmptyState";
import { IconButton } from "@/components/design-system/IconButton";
import type { MixRecord } from "@/data/repositories";
import { buildMixProfile, generateMix, refreshMix } from "@/features/mixes/generateMix";
import { playAll } from "@/lib/libraryPlayback";
import { songCountLabel } from "@/lib/playlistPresentation";
import { useMixStore } from "@/stores/mixStore";
import { usePreferencesStore } from "@/stores/preferencesStore";

/**
 * The Smart Mix surface (M11; spec: `mixes` — "Mix identity and naming",
 * "Mix refresh", "No signal, no mix"; task 4.3).
 *
 * Three rules the surface exists to keep honest:
 *
 * 1. **Nothing plays by itself.** Opening the page or rendering the list issues
 *    no playback and no generation; every track list starts only from a click.
 * 2. **A mix is named, not ranked.** Each row shows the name the listener
 *    already recognizes plus its plain track count — no "top", no score, no
 *    comparison between mixes.
 * 3. **No signal is stated, not faked.** With no local taste signal the surface
 *    says mixes appear after some listening instead of rendering a feed-derived
 *    set wearing the listener's name.
 */

export interface MixListProps {
  /** Heading for the surface; the compact Home section passes its own. */
  title?: string;
  /** Hide the "Build a mix" action — used where the section is list-only. */
  showGenerate?: boolean;
  className?: string;
}

/** A single mix row: its name, its size, and the two actions that change it. */
function MixRow({ mix, busy }: { mix: MixRecord; busy: boolean }) {
  const upsert = useMixStore((state) => state.upsert);
  const setStatus = useMixStore((state) => state.setStatus);
  const [refreshed, setRefreshed] = useState(false);

  const refresh = useCallback(async () => {
    setStatus("refreshing");
    setRefreshed(false);
    try {
      const profile = await buildMixProfile(Date.now());
      const languages = usePreferencesStore.getState().languages;
      if (profile === null) {
        setStatus("error", "Mixes could not be built: local data is unavailable.");
        return;
      }
      const result = await refreshMix(mix, { profile, languages, now: Date.now() });
      if (result === undefined) {
        // A refresh that found nothing new leaves the mix exactly as it was; the
        // listener is told why instead of watching a silently-unchanged list.
        setStatus("error", "No new tracks for this mix right now.");
        return;
      }
      upsert(result);
      setRefreshed(true);
    } catch (error: unknown) {
      setStatus(
        "error",
        error instanceof Error ? error.message : "The mix could not be refreshed.",
      );
    }
  }, [mix, setStatus, upsert]);

  return (
    <li
      className="flex items-center gap-3 rounded-cards bg-carbon p-3"
      data-testid={`mix-row-${mix.id}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-body-lg font-semibold text-pure-white">{mix.name}</span>
        <span className="text-body-lg font-regular text-mist">
          {songCountLabel(mix.tracks.length)}
          <span className="sr-only">, generated {mix.period}</span>
        </span>
        {refreshed ? (
          <span className="text-caption text-mist" role="status">
            Refreshed
          </span>
        ) : null}
      </div>

      <IconButton
        label={`Play ${mix.name}`}
        onClick={() => playAll(mix.tracks)}
        disabled={mix.tracks.length === 0}
      >
        <Play className="size-5" aria-hidden="true" />
      </IconButton>

      <Button
        variant="ghost"
        onClick={() => void refresh()}
        disabled={busy}
        data-testid={`mix-refresh-${mix.id}`}
      >
        <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
        Refresh
      </Button>
    </li>
  );
}

/**
 * The listener's mixes, newest generation first.
 *
 * Generation is an explicit action: the list never generates on mount, because a
 * mix costs provider work and the listener should decide when that happens.
 */
export function MixList({
  title = "Smart Mixes",
  showGenerate = true,
  className = "",
}: MixListProps) {
  const mixes = useMixStore((state) => state.mixes);
  const status = useMixStore((state) => state.status);
  const error = useMixStore((state) => state.error);
  const hydrate = useMixStore((state) => state.hydrate);
  const upsert = useMixStore((state) => state.upsert);
  const setStatus = useMixStore((state) => state.setStatus);
  const languages = usePreferencesStore((state) => state.languages);
  const [noSignal, setNoSignal] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const busy = status === "generating";

  const generate = useCallback(async () => {
    setStatus("generating");
    setNoSignal(false);
    try {
      const now = Date.now();
      const profile = await buildMixProfile(now);
      if (profile === null) {
        setStatus("error", "Mixes could not be built: local data is unavailable.");
        return;
      }
      const outcome = await generateMix({ profile, languages, now });
      if (outcome.status === "no-signal") {
        // Decision 5, in the surface: this is not a provider failure and must not
        // read like one.
        setNoSignal(true);
        setStatus("idle");
        return;
      }
      if (outcome.status === "empty") {
        setStatus("error", "The feed had nothing new for a mix right now.");
        return;
      }
      if (outcome.status === "unavailable") {
        setStatus("error", outcome.message);
        return;
      }
      setNoSignal(false);
      upsert(outcome.mix);
    } catch (caught: unknown) {
      setStatus("error", caught instanceof Error ? caught.message : "The mix could not be built.");
    }
  }, [languages, setStatus, upsert]);

  return (
    <section className={`flex flex-col gap-4 ${className}`} data-testid="mix-list">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-title-lg font-bold text-pure-white">{title}</h2>
        {showGenerate ? (
          <Button onClick={() => void generate()} disabled={busy} data-testid="mix-generate">
            <Sparkles className="size-5" aria-hidden="true" />
            {busy ? "Building…" : "Build a mix"}
          </Button>
        ) : null}
      </div>

      {error !== null ? (
        <p role="alert" className="text-body-lg text-error">
          {error}
        </p>
      ) : null}

      {mixes.length === 0 && !noSignal ? (
        <EmptyState
          icon={<Sparkles className="size-8" aria-hidden="true" />}
          title="No mixes yet"
          description="Mixes are built on this device from what you like and play."
          className="bg-carbon"
        />
      ) : null}

      {noSignal ? (
        <p className="text-body-lg text-mist" role="status" data-testid="mix-no-signal">
          Mixes appear after some listening — like a track or play a few songs on this device, then
          build one.
        </p>
      ) : null}

      {mixes.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="mix-rows">
          {mixes.map((mix) => (
            <MixRow key={mix.id} mix={mix} busy={status === "refreshing"} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
