"use client";

import Link from "next/link";
import { Clock3, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/design-system/Button";
import { EmptyState } from "@/components/design-system/EmptyState";
import type { ArtistSummary, ListeningEventRecord } from "@/data/repositories";
import { classifyPlay, type PlayVerdict } from "@/features/insights/classifyPlay";
import { localDayKey } from "@/features/insights/buildStats";
import { albumHrefFromRelease } from "@/features/album/albumKeys";
import { artistHref, isProviderEntityId } from "@/features/artist/artistKeys";
import { songCountLabel } from "@/lib/playlistPresentation";
import { useHistoryStore } from "@/stores/historyStore";

/**
 * The local listening record (M11; spec: `insights` — "History surface"; task
 * 4.1).
 *
 * What this surface deliberately does **not** do, because the requirement rules
 * it out: it shows no totals, no ranking, and nothing about sharing. A history
 * page that reported "you listened 42 hours" would be claiming completeness this
 * device does not have — the record only covers what was played *in this app*,
 * and only since it was installed. The statistics surface is the one that
 * aggregates, and it labels what it is.
 *
 * Verdicts are read from the recorded event at render time (never stored), so the
 * row and the statistics always report the same classification for the same play.
 */

/** How a play ended, in the listener's words rather than the rule's. */
const VERDICT_LABEL: Record<PlayVerdict, string> = {
  completed: "Played through",
  partial: "Played partly",
  skipped: "Skipped",
};

interface DayGroup {
  /** Local `YYYY-MM-DD` key. */
  key: string;
  /** Human label for the day, relative where that is clearer than a date. */
  label: string;
  events: ListeningEventRecord[];
}

/** The listener's local day, labelled as today, yesterday, or a date. */
function dayLabel(key: string, today: string, yesterday: string): string {
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const [year, month, day] = key.split("-");
  if (year === undefined || month === undefined || day === undefined) return key;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(parsed.getTime())) return key;
  // A date inside the last year is easier to place without a year; anything
  // older gets one, because "March 2024" and "March 2025" are not the same day.
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(year === today.slice(0, 4) ? {} : { year: "numeric" }),
  });
}

/**
 * Events in, day groups out — newest day first, newest play first inside a day.
 *
 * Takes the two reference day *keys* rather than an instant, so the grouping
 * itself is pure: reading the clock is the caller's job, which keeps the impure
 * read in one place (the surface's effect) rather than spread through render.
 */
export function groupEventsByDay(
  events: readonly ListeningEventRecord[],
  today: string,
  yesterday: string,
): DayGroup[] {
  const groups = new Map<string, ListeningEventRecord[]>();
  for (const event of events) {
    const key = localDayKey(event.playedAt);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, [event]);
    } else {
      existing.push(event);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left < right ? 1 : left > right ? -1 : 0))
    .map(([key, dayEvents]) => ({
      key,
      label: dayLabel(key, today, yesterday),
      events: [...dayEvents].sort((a, b) => b.playedAt - a.playedAt),
    }));
}

/** The time of day a play happened, in the listener's locale. */
function timeLabel(playedAt: number): string {
  return new Date(playedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The artist route key for a recorded credit: a provider artist id when the
 * credit has a usable one, else the normalized name. The same rule the Home
 * shelves use, so a link from here and a link from there resolve to one artist.
 */
function artistKeyFor(artist: ArtistSummary): string {
  const id = artist.id;
  return id !== undefined && isProviderEntityId(id) ? id : artist.name;
}

/** The listener's current local day and the one before it. */
const EMPTY_REFERENCE_DAYS = { today: "", yesterday: "" };

export function HistoryView() {
  const events = useHistoryStore((state) => state.events);
  const hydrated = useHistoryStore((state) => state.hydrated);
  const hydrate = useHistoryStore((state) => state.hydrate);
  const clear = useHistoryStore((state) => state.clear);
  const [referenceDays, setReferenceDays] = useState(EMPTY_REFERENCE_DAYS);

  useEffect(() => {
    // The clock is read *after* the record loads, never during render, and only
    // the two derived day keys are kept — so nothing persisted can go stale and
    // nothing impure runs while rendering. Publishing the keys inside the
    // `finally` keeps the state update asynchronous: a synchronous set-state in an
    // effect would cascade a render the page does not need.
    let superseded = false;
    void hydrate().finally(() => {
      if (superseded) return;
      const now = Date.now();
      setReferenceDays({
        today: localDayKey(now),
        yesterday: localDayKey(now - 24 * 60 * 60 * 1000),
      });
    });
    return () => {
      superseded = true;
    };
  }, [hydrate]);

  // The day grouping is a *reading* of the events against the listener's current
  // day, not a stored fact. The clock is read once in the effect below — never
  // during render — and only the two derived keys are kept, so nothing persisted
  // can go stale and nothing impure runs while rendering.
  const groups = useMemo(
    () => groupEventsByDay(events, referenceDays.today, referenceDays.yesterday),
    [events, referenceDays],
  );
  const onClear = useCallback(() => {
    void clear();
  }, [clear]);

  return (
    <div className="flex flex-col gap-6" data-testid="history-view">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-title-lg font-bold text-pure-white">Listening history</h2>
          <p className="text-body-lg text-mist">
            The local record of what was played in Spotivibe on this device. It is not a ranking,
            and it is not shared.
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={onClear}
          disabled={events.length === 0}
          data-testid="history-clear"
        >
          <Trash2 className="size-5" aria-hidden="true" />
          Clear history
        </Button>
      </header>

      {hydrated && events.length === 0 ? (
        <EmptyState
          icon={<Clock3 className="size-8" aria-hidden="true" />}
          title="Nothing here yet"
          description="Tracks you play are recorded on this device and listed here by day."
          className="bg-carbon"
        />
      ) : null}

      {groups.map((group) => (
        <section
          key={group.key}
          className="flex flex-col gap-2"
          data-testid={`history-day-${group.key}`}
        >
          <h3 className="text-title-md font-semibold text-pure-white">
            {group.label}
            <span className="ml-2 text-body-lg font-regular text-mist">
              {songCountLabel(group.events.length)}
            </span>
          </h3>
          <ul className="flex flex-col gap-1">
            {group.events.map((event) => {
              const verdict = classifyPlay({
                secondsPlayed: event.secondsPlayed,
                durationSeconds: event.track.durationSeconds,
                completed: event.completed,
                skipped: event.skipped,
              });
              const album = event.track.album;
              return (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center gap-2 rounded-cards bg-carbon p-3"
                  data-testid="history-row"
                >
                  <span className="min-w-0 flex-1 truncate text-body-lg text-pure-white">
                    {event.track.title}
                  </span>
                  <span className="flex min-w-0 shrink-0 items-center gap-1 text-body-lg text-mist">
                    {event.track.artists.map((artist, index) => (
                      <span key={artist.id ?? artist.name}>
                        {index > 0 ? ", " : ""}
                        <Link
                          href={artistHref(artistKeyFor(artist))}
                          className="underline-offset-2 hover:text-pure-white hover:underline"
                        >
                          {artist.name}
                        </Link>
                      </span>
                    ))}
                    {album !== undefined ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <Link
                          href={albumHrefFromRelease(album)}
                          className="underline-offset-2 hover:text-pure-white hover:underline"
                        >
                          {album.title}
                        </Link>
                      </>
                    ) : null}
                  </span>
                  <span className="text-body-lg text-mist">{timeLabel(event.playedAt)}</span>
                  <span className="text-body-lg text-mist" data-testid="history-verdict">
                    {VERDICT_LABEL[verdict]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
