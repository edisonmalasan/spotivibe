import { describe, expect, it } from "vitest";
import { parsePlaylistRef } from "@/server/music/playlistRef";

/**
 * Fixture matrix for `parsePlaylistRef` (design decision 9): every accepted
 * reference form, every rejection class. Pure — no network, so "no upstream
 * call on rejection" is proven separately by the route contract test.
 */

const ID = "PLQdn7YisXz3PVuntxWtNNhIXbpZQ2-fyP";

describe("parsePlaylistRef — accepted forms", () => {
  it.each([
    ["bare playlist ID", ID],
    ["watch URL", `https://www.youtube.com/watch?v=3E78T8h5EhA&list=${ID}`],
    [
      "watch URL with the list parameter last",
      `https://www.youtube.com/watch?v=3E78T8h5EhA&list=${ID}&index=2`,
    ],
    ["playlist URL", `https://www.youtube.com/playlist?list=${ID}`],
    ["music.youtube.com playlist URL", `https://music.youtube.com/playlist?list=${ID}`],
    ["embed URL", `https://www.youtube.com/embed/3E78T8h5EhA?list=${ID}`],
    ["youtu.be short link", `https://youtu.be/3E78T8h5EhA?list=${ID}`],
    ["subdomain host", `https://m.youtube.com/watch?v=x&list=${ID}`],
    ["surrounding whitespace", `  https://www.youtube.com/playlist?list=${ID}  `],
    ["http scheme", `http://www.youtube.com/playlist?list=${ID}`],
  ])("accepts a %s", (_label, src) => {
    expect(parsePlaylistRef(src)).toBe(ID);
  });

  it("accepts any ID-shaped list parameter, not just PL-prefixed ones", () => {
    expect(parsePlaylistRef("RDMM3E78T8h5EhA")).toBe("RDMM3E78T8h5EhA");
    expect(parsePlaylistRef("https://www.youtube.com/watch?v=x&list=RDMM3E78T8h5EhA")).toBe(
      "RDMM3E78T8h5EhA",
    );
  });

  it("returns the ID even when the URL carries extra parameters", () => {
    expect(parsePlaylistRef(`https://www.youtube.com/playlist?list=${ID}&index=4&si=abc123`)).toBe(
      ID,
    );
  });
});

describe("parsePlaylistRef — rejections", () => {
  it.each([
    ["empty string", ""],
    ["whitespace-only string", "   "],
    ["arbitrary text", "my favorite playlist"],
    ["protocol-less YouTube URL", `www.youtube.com/playlist?list=${ID}`],
    ["non-YouTube host", `https://example.com/playlist?list=${ID}`],
    ["YouTube-lookalike host", `https://youtube.com.evil.example/playlist?list=${ID}`],
    ["foreign scheme", `ftp://youtube.com/playlist?list=${ID}`],
    ["watch URL without a list parameter", "https://www.youtube.com/watch?v=3E78T8h5EhA"],
    ["playlist-less path on a YouTube host", `https://www.youtube.com/@redlist/streams?list=${ID}`],
    ["search results path", `https://www.youtube.com/results?search_query=x&list=${ID}`],
    ["short link without a list parameter", "https://youtu.be/3E78T8h5EhA"],
    ["list parameter that is not ID-shaped", "https://www.youtube.com/playlist?list=abc"],
    [
      "list parameter with invalid characters",
      "https://www.youtube.com/playlist?list=" + "x".repeat(65),
    ],
    ["malformed URL", "https://[not-a-host]/playlist?list=" + ID],
  ])("rejects %s with null", (_label, src) => {
    expect(parsePlaylistRef(src)).toBeNull();
  });
});
