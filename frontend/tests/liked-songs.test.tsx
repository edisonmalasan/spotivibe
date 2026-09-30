import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/repositories";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { LikedSongsView } from "@/features/library/LikedSongsView";
import { QueueView } from "@/features/queue/QueueView";
import { playAll, shufflePlay } from "@/lib/libraryPlayback";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Liked Songs surface + bulk-play coverage (tasks 6.1–6.2, design §3/§6):
 * newest-first row metadata, per-row play/unlike with cross-surface like
 * state, the title/artist filter, the `aria-pressed` list/grid toggle, the
 * empty state's visibly disabled controls, play-all/shuffle adopting the
 * collection with the `library` source (queue label "From your library"),
 * ensure-on shuffle semantics, and no autoplay on mount — all against the
 * real fake-indexeddb repositories.
 */

// Cold fake-indexeddb hydration can exceed the 1s default (settings precedent).
configure({ asyncUtilTimeout: 5000 });

// SectionHeader (inside QueueView) renders links through next/link.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const trackA = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Karma Police",
  artists: [{ name: "Radiohead" }],
  album: { title: "OK Computer" },
  durationSeconds: 260,
});
const trackB = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Weird Fishes",
  artists: [{ name: "Radiohead" }],
  album: { title: "In Rainbows" },
  durationSeconds: 250,
});
const trackC = makeTrack({
  id: "youtube:ccc",
  providerId: "ccc",
  title: "Bohemian Rhapsody",
  artists: [{ name: "Queen" }],
  album: { title: "A Night at the Opera" },
  durationSeconds: 354,
});

let repositories: RepositorySet;

beforeEach(async () => {
  resetLibraryStore();
  resetPlayerStore();
  resetQueueStore();
  repositories = await getLocalData();
  await repositories.resetAll();
});

/** Like `tracks` in order — the repository (and store) then reads newest-first. */
async function seedLiked(tracks: Track[]): Promise<void> {
  for (const [index, track] of tracks.entries()) {
    await repositories.likedTracks.like(track, 1_000 + index);
  }
}

function queueIds(): string[] {
  return useQueueStore.getState().queue.map((track) => track.id);
}

describe("Liked Songs surface (task 6.1)", () => {
  it("renders newest-first row metadata with per-row play and unlike", async () => {
    await seedLiked([trackA, trackB]); // B liked last → shown first
    render(<LikedSongsView />);

    // Wait past the loading status (the h1 renders in both states).
    expect(await screen.findByText("2 songs")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Liked Songs" })).toBeInTheDocument();

    // Newest-first order with canonical row metadata (artist + album + duration).
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("button", { name: "Play Weird Fishes" })).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Play Karma Police" })).toBeInTheDocument();
    expect(screen.getByText("In Rainbows")).toBeInTheDocument();
    expect(screen.getByText("4:20")).toBeInTheDocument(); // 260s formatted

    // Per-row play: this track with the full ordered collection as context.
    fireEvent.click(screen.getByRole("button", { name: "Play Weird Fishes" }));
    expect(useQueueStore.getState().source).toBe("library");
    expect(queueIds()).toEqual([trackB.id, trackA.id]);
    expect(useQueueStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(trackB.id);

    // Unlike removes the row without a remount and clears shared like state.
    fireEvent.click(screen.getByRole("button", { name: "Remove Weird Fishes from Liked Songs" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Play Weird Fishes" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Play Karma Police" })).toBeInTheDocument();
    expect(screen.getByText("1 song")).toBeInTheDocument();
    expect(useLibraryStore.getState().likedIds.has(trackB.id)).toBe(false); // search/Now Playing read this
    expect(await repositories.likedTracks.isLiked(trackB.id)).toBe(false);
  });

  it("filters by title and artist text, shows a no-matches line, restores on clear", async () => {
    await seedLiked([trackA, trackB, trackC]);
    render(<LikedSongsView />);
    expect(
      await screen.findByRole("button", { name: "Play Bohemian Rhapsody" }),
    ).toBeInTheDocument();

    const filter = screen.getByLabelText("Filter liked songs");
    fireEvent.change(filter, { target: { value: "queen" } }); // artist match
    expect(screen.getByRole("button", { name: "Play Bohemian Rhapsody" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play Karma Police" })).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "karma" } }); // title match
    expect(screen.getByRole("button", { name: "Play Karma Police" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Play Bohemian Rhapsody" }),
    ).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Play Karma Police" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Weird Fishes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Bohemian Rhapsody" })).toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  it("switches between the aria-pressed list and grid presentations", async () => {
    await seedLiked([trackA]);
    render(<LikedSongsView />);
    expect(await screen.findByRole("button", { name: "Play Karma Police" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "List view", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grid view", pressed: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(screen.getByRole("button", { name: "Grid view", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List view", pressed: false })).toBeInTheDocument();
    // The same collection as artwork tiles — cover, title, artist.
    expect(screen.queryByRole("button", { name: "Play Karma Police" })).not.toBeInTheDocument();
    const tile = screen.getByRole("button", { name: /Karma Police/ });
    expect(tile).toHaveTextContent("Radiohead");

    // Activating a tile plays it within the collection.
    fireEvent.click(tile);
    expect(useQueueStore.getState().source).toBe("library");
    expect(queueIds()).toEqual([trackA.id]);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(trackA.id);

    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(screen.getByRole("button", { name: "Play Karma Police" })).toBeInTheDocument();
  });

  it("shows the empty state with visibly disabled bulk controls", async () => {
    render(<LikedSongsView />);

    expect(await screen.findByText("No liked songs yet")).toBeInTheDocument();
    expect(screen.getByText("Tap the heart on any song to save it here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shuffle" })).toBeDisabled();

    // Inert as well as disabled — nothing enters the queue or the player.
    fireEvent.click(screen.getByRole("button", { name: "Play all" }));
    expect(useQueueStore.getState().queue).toHaveLength(0);
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(usePlayerStore.getState().status).toBe("idle");
  });

  it("never autoplays on mount (spec)", async () => {
    await seedLiked([trackA, trackB]);
    render(<LikedSongsView />);
    expect(await screen.findByRole("button", { name: "Play Karma Police" })).toBeInTheDocument();

    expect(usePlayerStore.getState().status).toBe("idle");
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(usePlayerStore.getState().loadRequest).toBeNull();
    expect(useQueueStore.getState().queue).toHaveLength(0);
  });
});

describe("library bulk play (task 6.2)", () => {
  it("play all adopts the full collection with the library source label", async () => {
    await seedLiked([trackA, trackB]);
    render(<LikedSongsView />);
    expect(await screen.findByRole("button", { name: "Play Weird Fishes" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play all" }));

    // First liked track starts, the whole ordered collection becomes context.
    expect(useQueueStore.getState().queueIndex).toBe(0);
    expect(queueIds()).toEqual([trackB.id, trackA.id]);
    expect(useQueueStore.getState().source).toBe("library");
    expect(useQueueStore.getState().shuffle).toBe(false); // plain play-all leaves shuffle alone
    expect(usePlayerStore.getState().currentTrack?.id).toBe(trackB.id);

    // The queue surface labels the context "From your library".
    render(<QueueView />);
    expect(screen.getByText("From your library")).toBeInTheDocument();
  });

  it("shuffle ensures shuffle is on and starts within the collection", async () => {
    await seedLiked([trackA, trackB]);
    render(<LikedSongsView />);
    expect(await screen.findByRole("button", { name: "Play Karma Police" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));

    expect(useQueueStore.getState().shuffle).toBe(true);
    expect(useQueueStore.getState().source).toBe("library");
    expect(useQueueStore.getState().queueIndex).toBe(0); // deterministic start
    expect(queueIds()).toEqual([trackB.id, trackA.id]);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(trackB.id);

    // Ensure-on, never a flip-off: a second activation keeps shuffle on.
    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
    expect(useQueueStore.getState().shuffle).toBe(true);
  });

  it("keeps an already-on shuffle on across plain play-all", async () => {
    useQueueStore.setState({ shuffle: true });
    playAll([trackA, trackB]);
    expect(useQueueStore.getState().shuffle).toBe(true);
    shufflePlay([trackA]);
    expect(useQueueStore.getState().shuffle).toBe(true);
  });

  it("treats empty collections as inert no-ops", () => {
    playAll([]);
    shufflePlay([]);

    expect(useQueueStore.getState().queue).toHaveLength(0);
    expect(useQueueStore.getState().shuffle).toBe(false);
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(usePlayerStore.getState().status).toBe("idle");
  });
});

/**
 * M13 regression: a stored row that cannot fill every field must not take the
 * surface down with it.
 *
 * The browser evidence run wrote a liked row straight into IndexedDB - a route the
 * repository layer does not expose - whose track had no `artists`, and `/library/liked`
 * crashed into the route error boundary while offline. Two things came out of it: the
 * surface now skips what it cannot render (the same "stored records are untrusted"
 * rule the repositories already apply), and the harness now seeds through the
 * repository so its evidence run is not measuring an impossible state.
 *
 * This test keeps the impossible state deliberately: a row can also arrive from a
 * backup written by an older build, an external tool, or a future migration, and the
 * surface's job is to show the rows it can rather than to white-screen.
 */
describe("LikedSongsView with an incomplete stored record", () => {
  it("skips a row it cannot render and still shows the rest", async () => {
    const good = makeTrack({
      id: "youtube:good",
      providerId: "good",
      title: "Roads",
      artists: [{ name: "Portishead" }],
    });
    await repositories.likedTracks.like(good);
    // Written the way the evidence run wrote it: raw IndexedDB, bypassing the
    // repository's own validation, which is exactly how a row from an external tool
    // or an older backup would arrive.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("spotivibe");
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("likedTracks", "readwrite");
        tx.objectStore("likedTracks").put({
          trackId: "youtube:broken",
          likedAt: 2,
          track: { providerId: "broken", title: "Roads (broken)", duration: 1 },
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      request.onerror = () => reject(request.error);
    });
    resetLibraryStore();

    render(<LikedSongsView />);
    // The complete row renders...
    expect(await screen.findByText("Roads")).toBeInTheDocument();
    // ...and the incomplete one is skipped rather than rendered or crashed on.
    expect(screen.queryByText("Roads (broken)")).not.toBeInTheDocument();
  });
});
