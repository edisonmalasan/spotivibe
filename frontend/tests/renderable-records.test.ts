import { describe, expect, it } from "vitest";
import {
  isRenderableEvent,
  isRenderablePlaylist,
  isRenderableTrack,
  renderableEvents,
  renderablePlaylists,
  renderableTracks,
  type RenderableTrack,
} from "@/data/repositories";
import type { PlaylistRecord, Track } from "@/data/repositories";

/**
 * M14 task 2.4: "a stored record is untrusted data" as a rule, not a habit.
 *
 * M13's verification pass found a liked track with no `artists` crashing
 * `/library/liked` into the route error boundary, and fixed it in that one surface.
 * These tests are about the *shared* guard that replaced it: the same malformed record
 * must be survivable anywhere, and the shape of what counts as unrenderable has to be
 * stated here rather than rediscovered per surface.
 */

const COMPLETE_TRACK = {
  providerId: "dQw4w9WgXcQ",
  title: "A Title",
  artists: [{ name: "An Artist" }, { name: "Another Artist" }],
  artwork: [{ url: "https://i.ytimg.com/vi/x/hq.jpg", width: 480, height: 480 }],
  durationSeconds: 212,
} satisfies Partial<Track> as Track;

describe("isRenderableTrack (task 2.4)", () => {
  it("accepts a complete track", () => {
    expect(isRenderableTrack(COMPLETE_TRACK)).toBe(true);
    // Artwork is optional; a track with none is still renderable.
    expect(isRenderableTrack({ ...COMPLETE_TRACK, artwork: [] })).toBe(true);
    expect(isRenderableTrack({ ...COMPLETE_TRACK, artwork: undefined })).toBe(true);
  });

  it("rejects the record that crashed /library/liked", () => {
    // The exact shape M13's browser run found: a stored track with no artists at all.
    const { artists: _artists, ...withoutArtists } = COMPLETE_TRACK;
    expect(isRenderableTrack(withoutArtists)).toBe(false);
  });

  it("rejects a record whose every field is unusable", () => {
    for (const value of [null, undefined, "a string", 42, [], {}]) {
      expect(isRenderableTrack(value), JSON.stringify(value ?? null)).toBe(false);
    }
  });

  it("rejects a partially-shaped artist list rather than rendering an empty byline", () => {
    // `[{ name: "One" }, {}]` renders as "One" plus a gap; it is not a row anyone can
    // read, and it is not a record to repair by inventing the missing name.
    expect(isRenderableTrack({ ...COMPLETE_TRACK, artists: [{ name: "One" }, {}] })).toBe(false);
    expect(isRenderableTrack({ ...COMPLETE_TRACK, artists: [{ name: "" }] })).toBe(false);
    expect(isRenderableTrack({ ...COMPLETE_TRACK, artists: [] })).toBe(false);
    expect(isRenderableTrack({ ...COMPLETE_TRACK, artists: "An Artist" })).toBe(false);
  });

  it("rejects a track with nothing to play", () => {
    // `providerId` is how playback resolves a track; a row without one fails when
    // pressed, so it is not offered as a row at all.
    expect(isRenderableTrack({ ...COMPLETE_TRACK, providerId: "" })).toBe(false);
    const { providerId: _id, ...withoutId } = COMPLETE_TRACK;
    expect(isRenderableTrack(withoutId)).toBe(false);
  });

  it("rejects a blank title, which is not a title", () => {
    expect(isRenderableTrack({ ...COMPLETE_TRACK, title: "   " })).toBe(false);
  });
});

describe("renderableTracks (task 2.4)", () => {
  it("keeps what it can render, in the order it received it, and skips the rest", () => {
    const good = { ...COMPLETE_TRACK, title: "Kept" };
    const alsoGood = { ...COMPLETE_TRACK, title: "Also Kept" };
    const { artists: _a, ...broken } = COMPLETE_TRACK;
    const kept = renderableTracks([good, broken, null, alsoGood, { ...COMPLETE_TRACK, title: "" }]);
    expect(kept.map((track) => track.title)).toEqual(["Kept", "Also Kept"]);
  });

  it("narrows the type, so a caller cannot read a field it did not check", () => {
    // The property that makes this better than an inline `filter`: `artists` is
    // `Array<{ name: string }>` on the returned type, so `artist.name` compiles without
    // a cast and the compiler rejects a caller that assumes anything looser.
    const [first] = renderableTracks([COMPLETE_TRACK]) as [RenderableTrack];
    const names: string[] = first.artists.map((artist) => artist.name);
    expect(names).toEqual(["An Artist", "Another Artist"]);
  });

  it("returns an empty list rather than throwing on a wholly malformed dataset", () => {
    // The failure this exists to prevent is a route error boundary, which is a blank
    // page; an empty list is a surface with nothing in it.
    expect(renderableTracks([null, undefined, 1, "x", {}])).toEqual([]);
  });
});

describe("isRenderablePlaylist (task 2.4)", () => {
  const complete = {
    id: "playlist-1",
    name: "A Playlist",
    createdAt: 1,
    updatedAt: 2,
    tracks: [],
  } satisfies PlaylistRecord;

  it("accepts an empty playlist, which is a legitimate thing to have made", () => {
    expect(isRenderablePlaylist(complete)).toBe(true);
    expect(isRenderablePlaylist({ ...complete, description: "notes" })).toBe(true);
  });

  it("rejects a playlist missing what a card renders or routes with", () => {
    for (const missing of ["id", "name", "tracks", "updatedAt"]) {
      const broken: Record<string, unknown> = { ...complete };
      delete broken[missing];
      expect(isRenderablePlaylist(broken), missing).toBe(false);
    }
    expect(isRenderablePlaylist({ ...complete, tracks: "one track" })).toBe(false);
  });

  it("filters a list without inventing records", () => {
    const kept = renderablePlaylists([complete, { ...complete, id: "" }, null]);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe("playlist-1");
  });
});

describe("isRenderableEvent (task 2.4)", () => {
  const completeEvent = {
    id: "event-1",
    trackId: COMPLETE_TRACK.providerId,
    playedAt: 1_700_000_000_000,
    secondsPlayed: 200,
    track: COMPLETE_TRACK,
  } as unknown as Parameters<typeof isRenderableEvent>[0];

  it("accepts a complete event and judges it by its track", () => {
    expect(isRenderableEvent(completeEvent)).toBe(true);
    const { artists: _artists, ...brokenTrack } = COMPLETE_TRACK;
    // The event is intact; its track is not renderable, so the row is not either.
    expect(
      isRenderableEvent({
        ...(completeEvent as unknown as Record<string, unknown>),
        track: brokenTrack,
      }),
    ).toBe(false);
  });

  it("rejects an event it could not update or place", () => {
    // An event is looked up by id when its measurements are written (M11) and grouped
    // by day from its timestamp, so both have to be real - not merely present.
    // Each case is a field replaced with a value of the wrong type, which is the shape
    // a hand-edited backup file actually has.
    const base = completeEvent as unknown as Record<string, unknown>;
    const cases: Array<[string, unknown]> = [
      ["id", ""],
      ["trackId", ""],
      ["playedAt", Number.NaN],
      ["playedAt", "yesterday"],
      ["id", 7],
    ];
    for (const [field, value] of cases) {
      expect(isRenderableEvent({ ...base, [field]: value }), `${field}=${String(value)}`).toBe(
        false,
      );
    }
  });

  it("skips malformed events from a mixed list", () => {
    const kept = renderableEvents([
      completeEvent,
      { id: "", playedAt: 1, track: COMPLETE_TRACK },
      null,
    ]);
    expect(kept).toHaveLength(1);
  });
});
