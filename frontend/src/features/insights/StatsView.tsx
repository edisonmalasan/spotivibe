"use client";

import { BarChart3, Clock3, Flame } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/design-system/EmptyState";
import { getLocalData } from "@/data/localData";
import type { ListeningEventRecord } from "@/data/repositories";
import { buildStats, type ListeningStats, type WeightedStat } from "@/features/insights/buildStats";
import { useHistoryStore } from "@/stores/historyStore";

/**
 * Listening statistics (M11; spec: `insights` — "Local listening statistics",
 * "Listening streaks"; task 4.2).
 *
 * Two properties this surface is built around:
 *
 * 1. **Nothing is aggregated in storage.** Every number here is computed from the
 *    history events at read time, so clearing history changes these numbers with no
 *    invalidation step and no stale figure can survive. The events come from the
 *    repository, deliberately *not* from `historyStore`, whose 50-event window is
 *    the Recently Played shelf's budget and far too small a base for totals.
 * 2. **Every number says where it came from.** Each block is labelled as derived
 *    from the local record, and a missing language or category leaves its block
 *    absent rather than filled with a guess.
 */

/**
 * `3725` → `1 h 2 m`, the way a person would say it.
 *
 * Seconds are shown below a minute rather than truncated: a listener who has
 * played four 13-second tracks has listened to something, and reporting that as
 * "0 min" would be the floor of the format leaking into the number.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds} sec`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** A titled block of one statistic, always labelled as locally derived. */
function StatBlock({
  title,
  icon,
  children,
  testId,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h3 className="flex items-center gap-2 text-title-md font-semibold text-pure-white">
        {icon}
        {title}
      </h3>
      {children}
      <p className="text-caption text-mist">Derived from this device&rsquo;s listening record.</p>
    </section>
  );
}

/** A weighted list (top tracks, artists, a breakdown), rendered as counts. */
function WeightedList({ items, unit }: { items: WeightedStat[]; unit: string }) {
  return (
    <ol className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.key} className="flex items-baseline justify-between gap-3 text-body-lg">
          <span className="min-w-0 truncate text-pure-white">{item.label}</span>
          <span className="shrink-0 text-mist">
            {item.count} {unit}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function StatsView() {
  const [stats, setStats] = useState<ListeningStats | null>(null);
  const [failed, setFailed] = useState(false);
  // The store's `events` are the change signal: a recorded play or a clear
  // rewrites them, and this surface re-reads the whole dataset in response.
  const events = useHistoryStore((state) => state.events);
  const hydrated = useHistoryStore((state) => state.hydrated);

  useEffect(() => {
    // The store's `events` are the change signal: a recorded play or a clear
    // rewrites them, and this surface re-reads the whole dataset in response.
    //
    // The read is written inline rather than behind a helper because the report is
    // only ever published *after* the awaits below: publishing synchronously from
    // an effect would show a stale or partial report and cascade a second render.
    // The flag drops a result from an unmounted or superseded read, so a slow one
    // cannot overwrite a newer report.
    let superseded = false;
    void (async () => {
      try {
        const data = await getLocalData();
        // The *whole* dataset, not the in-memory window.
        const all: ListeningEventRecord[] = await data.listeningHistory.list();
        if (superseded) return;
        setStats(buildStats(all, { now: Date.now() }));
        setFailed(false);
      } catch {
        // A read failure is reported in place; the page it lives on keeps working.
        if (!superseded) setFailed(true);
      }
    })();
    return () => {
      superseded = true;
    };
  }, [events, hydrated]);

  const hasSignal = stats?.hasSignal === true;

  const breakdown = useMemo(() => {
    if (stats === null) return [];
    return [
      { label: "Languages", items: stats.languages },
      { label: "Genres and categories", items: stats.categories },
    ].filter((entry) => entry.items.length > 0);
  }, [stats]);

  return (
    <div className="flex flex-col gap-8" data-testid="stats-view">
      <header className="flex flex-col gap-1">
        <h2 className="text-title-lg font-bold text-pure-white">Listening stats</h2>
        <p className="text-body-lg text-mist">
          Computed on this device from the listening history Spotivibe recorded. Nothing is
          uploaded, and nothing here is a ranking.
        </p>
      </header>

      {/* M14: this alert was `text-error`, which matches no declared token, so it was
          painting in the inherited colour. `ErrorState` uses mist for its copy, and the
          announcement comes from the role rather than from the colour. */}
      {failed ? (
        <p role="alert" className="text-body-lg text-mist">
          Your statistics could not be read from local storage.
        </p>
      ) : null}

      {!failed && stats !== null && !hasSignal ? (
        <EmptyState
          icon={<BarChart3 className="size-8" aria-hidden="true" />}
          title="Nothing here yet"
          description="Play a few tracks on this device and your statistics will build up from them."
          className="bg-carbon"
        />
      ) : null}

      {hasSignal && stats !== null ? (
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap gap-6">
            <StatBlock
              title="Listening time"
              icon={<Clock3 className="size-5" aria-hidden="true" />}
              testId="stats-time"
            >
              <p className="text-title-lg font-bold text-pure-white" data-testid="stats-total-time">
                {formatDuration(stats.totalSeconds)}
              </p>
            </StatBlock>

            <StatBlock
              title="Plays"
              icon={<BarChart3 className="size-5" aria-hidden="true" />}
              testId="stats-plays"
            >
              <p className="text-title-lg font-bold text-pure-white" data-testid="stats-play-count">
                {stats.playCount}
              </p>
              <p className="text-body-lg text-mist" data-testid="stats-verdicts">
                {stats.verdicts.completed} played through · {stats.verdicts.partial} partly ·{" "}
                {stats.verdicts.skipped} skipped
              </p>
            </StatBlock>

            <StatBlock
              title="Streaks"
              icon={<Flame className="size-5" aria-hidden="true" />}
              testId="stats-streaks"
            >
              <p
                className="text-title-lg font-bold text-pure-white"
                data-testid="stats-current-streak"
              >
                {stats.streak.current}
              </p>
              <p className="text-body-lg text-mist" data-testid="stats-longest-streak">
                Longest: {stats.streak.longest}
              </p>
            </StatBlock>
          </div>

          {stats.topTracks.length > 0 ? (
            <StatBlock title="Most played tracks" icon={null} testId="stats-top-tracks">
              <WeightedList
                items={stats.topTracks}
                unit={Math.abs(stats.topTracks[0]?.count ?? 1) === 1 ? "play" : "plays"}
              />
            </StatBlock>
          ) : null}

          {stats.topArtists.length > 0 ? (
            <StatBlock title="Most played artists" icon={null} testId="stats-top-artists">
              <WeightedList
                items={stats.topArtists}
                unit={Math.abs(stats.topArtists[0]?.count ?? 1) === 1 ? "play" : "plays"}
              />
            </StatBlock>
          ) : null}

          {breakdown.length > 0 ? (
            <StatBlock title="Breakdown" icon={null} testId="stats-breakdown">
              <div className="flex flex-col gap-4">
                {breakdown.map((entry) => (
                  <div key={entry.label} className="flex flex-col gap-1">
                    <h4 className="text-body-lg font-semibold text-pure-white">{entry.label}</h4>
                    <WeightedList items={entry.items} unit="plays" />
                  </div>
                ))}
              </div>
            </StatBlock>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
