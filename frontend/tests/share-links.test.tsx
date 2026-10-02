import "fake-indexeddb/auto";
import { act, configure, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { AlbumView } from "@/features/album/AlbumView";
import { albumHref } from "@/features/album/albumKeys";
import { ArtistView } from "@/features/artist/ArtistView";
import { artistHref } from "@/features/artist/artistKeys";
import { PlaylistDetailView } from "@/features/playlists/PlaylistDetailView";
import { playlistHref } from "@/features/playlists/playlistKeys";
import { SearchResults } from "@/features/search/SearchResults";
import { trackSharePayload } from "@/features/sharing/trackShare";
import { buildSearchUrl } from "@/lib/searchUrl";
import { resetLibraryStore } from "@/stores/libraryStore";
import { resetPlayerStore } from "@/stores/playerStore";
import { resetQueueStore } from "@/stores/queueStore";
import { resetSearchStore } from "@/stores/searchStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * What each shareable surface shares (M18 tasks 5.3-5.5; spec `sharing` — "A
 * shareable surface shares a Spotivibe link").
 *
 * Three properties, three instruments:
 *
 * 1. **Each surface shares its own page URL**, produced by the *same* builder its
 *    links use. A behavioural assertion alone cannot catch a hand-written
 *    duplicate: for a `crypto.randomUUID()` id, `` `/playlist/${id}` `` and
 *    `playlistHref(id)` produce byte-identical strings, so an equality check on
 *    the shared URL passes on either. The structural sweep below is therefore a
 *    first-class assertion here, not a nicety — it is the only thing that can
 *    tell the builder from its own copy.
 * 2. **A track shares a Spotivibe URL**, not a provider one, and the search URL
 *    is what makes it resolvable.
 * 3. **Every action is named after what it shares**, so a column of share icons is
 *    distinguishable by label.
 */

configure({ asyncUtilTimeout: 5000 });

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

const track = makeTrack({
  id: "youtube:aaa",
  providerId: "dQw4w9WgXcQ",
  title: "Karma Police",
  artists: [{ name: "Radiohead" }],
  album: { title: "OK Computer" },
});

const ALBUM_KEY = "Dawn Chorus";
const ARTIST_KEY = "Aurora";

const ALBUM_RESOLUTION = {
  album: { id: "UCrelease000000000000", title: "Dawn Chorus", artistName: "Aurora" },
  tracks: [track],
  metadataIncomplete: false,
};

const ARTIST_RESOLUTION = {
  artist: { id: "UCchannel000000000000", name: "Aurora" },
  tracks: [track],
  related: [],
  releases: [],
};

/** Answer every fetch with whichever payload the URL is for. */
function stubProviders() {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const body = url.pathname.includes("album")
      ? ALBUM_RESOLUTION
      : url.pathname.includes("artist")
        ? ARTIST_RESOLUTION
        : { tracks: [track], diagnostics: {} };
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Install `navigator.share` and return the spy the payload is read from. */
function stubShare(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: spy });
  return spy;
}

function removeShare(): void {
  delete (navigator as unknown as Record<string, unknown>).share;
}

let repositories: RepositorySet;

beforeEach(async () => {
  resetSearchStore();
  resetLibraryStore();
  resetPlayerStore();
  resetQueueStore();
  nav.push.mockClear();
  repositories = await getLocalData();
  await repositories.resetAll();
  stubProviders();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeShare();
});

/**
 * Share `name` and return the payload the transport received.
 *
 * The guard is not defensive noise: `ShareData.url` is optional in the platform
 * type, and every assertion below is about whether a URL was sent *at all*. A
 * missing one therefore fails here with a message naming the surface, instead of
 * failing four assertions later as `undefined`.
 */
async function sharePayloadOf(name: string): Promise<{ url: string; title: string }> {
  const share = stubShare();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: `Share ${name}` }));
  });
  const payload = share.mock.calls[0]?.[0] as ShareData | undefined;
  if (payload?.url === undefined) {
    throw new Error(`no URL was shared for "${name}"`);
  }
  return { url: payload.url, title: payload.title ?? "" };
}

describe("an album shares its own page URL (task 5.3)", () => {
  it("sends the URL its own albumHref builds", async () => {
    render(<AlbumView albumKey={ALBUM_KEY} />);
    await screen.findByText("Karma Police");

    const payload = await sharePayloadOf("Dawn Chorus");
    expect(payload.url).toBe(albumHref(ALBUM_KEY));
    expect(payload.url).toBe("/album/Dawn%20Chorus");
  });
});

describe("an artist shares its own page URL (task 5.3)", () => {
  it("sends the URL its own artistHref builds", async () => {
    render(<ArtistView artistKey={ARTIST_KEY} />);
    await screen.findByText("Karma Police");

    const payload = await sharePayloadOf("Aurora");
    expect(payload.url).toBe(artistHref(ARTIST_KEY));
    expect(artistHref(ARTIST_KEY)).toBe("/artist/Aurora");
  });
});

describe("a playlist shares its own page URL (task 5.3)", () => {
  it("sends the URL the shared playlistHref builds", async () => {
    const playlist = await repositories.playlists.create({ name: "Road Trip" });
    render(<PlaylistDetailView playlistId={playlist.id} />);
    // The h1 only renders once the store's hydration settles with the playlist.
    await screen.findByRole("heading", { level: 1, name: "Road Trip" });

    const payload = await sharePayloadOf("Road Trip");
    expect(payload.url).toBe(playlistHref(playlist.id));
  });
});

describe("a track shares a resolvable search URL (task 5.4)", () => {
  it("sends a Spotivibe search URL for its artist and title, never a provider URL", async () => {
    render(<SearchResults tracks={[track]} query="karma" onRefine={vi.fn()} onPlay={vi.fn()} />);

    const payload = await sharePayloadOf("Karma Police");
    expect(payload.url).toBe(buildSearchUrl("Radiohead Karma Police"));
    // A Spotivibe URL, resolvable inside this application ...
    expect(payload.url.startsWith("/search?q=")).toBe(true);
    // ... and emphatically not somebody else's: a provider link would break the
    // moment this application is deployed elsewhere.
    expect(payload.url).not.toContain(track.providerId);
    expect(payload.url).not.toMatch(/^https?:/);
  });

  it("builds that URL in exactly one place, and it is a search URL", () => {
    // The lossiness of this representation — two tracks with the same artist and
    // title share a link, and nothing in the link identifies the recording — is
    // recorded in `features/sharing/trackShare.ts`. This asserts the *mechanism*
    // that record is about: the URL is composed by `buildSearchUrl`, so it is a
    // route this application actually serves.
    expect(trackSharePayload(track).url).toBe(buildSearchUrl("Radiohead Karma Police"));
    expect(trackSharePayload(track).url).not.toContain(track.providerId);
  });

  it("names every result's share action after that result", () => {
    const other = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Weird Fishes" });
    render(
      <SearchResults tracks={[track, other]} query="radio" onRefine={vi.fn()} onPlay={vi.fn()} />,
    );

    const rows = within(screen.getByTestId("search-results")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const action = within(row).getByRole("button", { name: /^Share / });
      expect(action.getAttribute("aria-label")).toMatch(/^Share .+/);
    }
  });
});

describe("every share action carries an accessible name (task 5.5)", () => {
  it("names the album, the artist, the playlist, and the track", async () => {
    const playlist = await repositories.playlists.create({ name: "Road Trip" });

    const album = render(<AlbumView albumKey={ALBUM_KEY} />);
    await screen.findByText("Karma Police");
    expect(screen.getByRole("button", { name: "Share Dawn Chorus" })).toBeInTheDocument();
    album.unmount();

    const artist = render(<ArtistView artistKey={ARTIST_KEY} />);
    await screen.findByText("Karma Police");
    expect(screen.getByRole("button", { name: "Share Aurora" })).toBeInTheDocument();
    artist.unmount();

    render(<PlaylistDetailView playlistId={playlist.id} />);
    await screen.findByRole("heading", { level: 1, name: "Road Trip" });
    expect(screen.getByRole("button", { name: "Share Road Trip" })).toBeInTheDocument();
  });

  it("names every control, so no share action is a bare icon", () => {
    render(<SearchResults tracks={[track]} query="karma" onRefine={vi.fn()} onPlay={vi.fn()} />);

    for (const button of screen.getAllByRole("button")) {
      const name = button.getAttribute("aria-label") ?? button.textContent ?? "";
      expect(name.trim(), "every control needs an accessible name").not.toBe("");
    }
    // And no two share actions in one row list are named the same.
    const shareNames = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? "")
      .filter((name) => name.startsWith("Share"));
    expect(shareNames).toEqual(["Share Karma Police"]);
  });
});

describe("the playlist route is built in one place", () => {
  /** Every `.ts`/`.tsx` file under `src`. */
  function sourceFiles(): Array<{ file: string; source: string }> {
    return readdirSync(srcDir, { withFileTypes: true, recursive: true }).flatMap((entry) => {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
      return [
        {
          file: relative(srcDir, join(entry.parentPath, entry.name)).replace(/\\/g, "/"),
          source: readFileSync(join(entry.parentPath, entry.name), "utf8"),
        },
      ];
    });
  }

  /** Comments removed: prose may mention the route; only code may build one. */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  }

  /**
   * A `/playlist/…` URL assembled anywhere but the builder.
   *
   * Both shapes a hand-written duplicate takes: a template literal and a `+`
   * concatenation. `playlistHref` itself is the single permitted owner, so the
   * rule is "one file may build a playlist route" rather than a list of
   * exceptions that could grow.
   */
  function playlistRouteConcatenations(source: string): string[] {
    const code = withoutComments(source);
    const found: string[] = [];
    if (/`\/playlist\/\$\{/.test(code)) found.push("template literal");
    if (/["'`]\/playlist\/["'`]\s*\+/.test(code)) found.push("string concatenation");
    return found;
  }

  it("finds none outside playlistKeys, proven on both shapes it must catch", () => {
    // The detector has to be able to fail, or "none found" is a report.
    expect(playlistRouteConcatenations("const href = `/playlist/${id}`;")).toEqual([
      "template literal",
    ]);
    expect(playlistRouteConcatenations('router.push("/playlist/" + id);')).toEqual([
      "string concatenation",
    ]);
    expect(playlistRouteConcatenations("const href = playlistHref(id);")).toEqual([]);
    // A route *pattern* in prose or a comment is documentation, not a URL.
    expect(playlistRouteConcatenations("// route: /playlist/[id]\nconst x = 1;")).toEqual([]);

    const offenders = sourceFiles()
      .filter(({ file }) => file !== "features/playlists/playlistKeys.ts")
      .flatMap(({ file, source }) =>
        playlistRouteConcatenations(source).map((shape) => `${file}: ${shape}`),
      );
    expect(offenders, "a playlist URL must be built by playlistHref").toEqual([]);
  });

  it("encodes the id, so a link and the key it came from cannot disagree", () => {
    expect(playlistHref("abc")).toBe("/playlist/abc");
    // Whitespace is absorbed and anything URL-significant is encoded, which is the
    // property a raw concatenation silently lacks.
    expect(playlistHref("  abc  ")).toBe("/playlist/abc");
    expect(playlistHref("a/b?c#d")).toBe("/playlist/a%2Fb%3Fc%23d");
  });
});
