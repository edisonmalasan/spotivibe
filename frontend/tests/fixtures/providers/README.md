# Provider fixtures

Raw upstream search responses captured once from the live providers and
committed byte-exact as the behavioral evidence for the tier parsers
(AGENTS.md fixture discipline). Tests parse these files; CI never hits the
network. This directory is listed in `frontend/.prettierignore` so the
captures stay byte-exact.

Captured: **2026-09-27** from the development machine (Windows, PowerShell
`Invoke-WebRequest`, browser-like User-Agent), query **"daft punk get lucky"**.

| Fixture | Tier | Request shape |
| --- | --- | --- |
| `ytm-search.json` (677,527 B) | YouTube Music Innertube | `POST https://music.youtube.com/youtubei/v1/search`, JSON body `{ context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20241202.01.00", hl: "en", gl: "US" } }, query, params: "EgWKAQIIAQ%3D%3D" }` (songs filter), `Origin`/`Referer` `https://music.youtube.com` |
| `ytweb-search.json` (1,198,094 B) | YouTube Web Innertube | `POST https://www.youtube.com/youtubei/v1/search`, JSON body `{ context: { client: { clientName: "WEB", clientVersion: "2.20241202.00.00", hl: "en", gl: "US" } }, query: "daft punk get lucky song" }` (the implementation appends ` song` on this tier, Lyrix-derived) |
| `invidious-search.json` (48,872 B) | Invidious | `GET https://invidious.f5.si/api/v1/search?q=daft%20punk%20get%20lucky&type=video` |
| `piped-search.json` (11,125 B) | Piped | `GET https://pipedapi.ducks.party/search?q=daft%20punk%20get%20lucky&filter=music_songs` |

Capture-date instance observations (basis for the built-in default lists;
overridable via server env): `yewtu.be` and `invidious.f5.si` answered for
Invidious; `pipedapi.ducks.party` and `api.piped.private.coffee` answered for
Piped; `inv.nadeko.net` and `pipedapi.kavin.rocks` returned 403 on this date.

Fixtures are responses, not requests: request shapes above are re-created by
the provider request builders and asserted in tests.

## Playlist fixtures (M7 import)

Captured **2026-09-29** from the development machine with the same
browser-like User-Agent as the search captures. Three playlists:

- **large** — `PLQdn7YisXz3PVuntxWtNNhIXbpZQ2-fyP` ("Perfect Sunday Morning
  Songs - Cozy Sunday Chill Music Playlist (Updated 2026)", 200 videos): the
  paging/continuation coverage for every tier that pages.
- **small** — `PLev66XKvqibTR3M7Ve8JUkRdhWNpR-BhG` ("sleep playlist bts",
  7 videos): single-page coverage with a header-only title and no description.
- **missing** — `PL` + 32 × `a` (bogus but well-formed): each tier's
  definitive "playlist does not exist" answer.

| Fixture | Tier | Request shape |
| --- | --- | --- |
| `ytm-playlist.json` (3,083,350 B) | YouTube Music Innertube | `POST https://music.youtube.com/youtubei/v1/browse`, JSON body `{ context: { client: { clientName: "WEB_REMIX", … } }, browseId: "VL<large>" }` — page 1: 100 rows + continuation token |
| `ytm-playlist-continuation.json` (2,576,164 B) | YouTube Music Innertube | same URL, JSON body `{ context: WEB_REMIX, continuation: <token from page 1> }` — rows 101–200, no further token |
| `ytm-playlist-small.json` (246,298 B) | YouTube Music Innertube | `POST …/browse` with `browseId: "VL<small>"` — 7 rows, header title, no description shelf, no continuation |
| `ytm-playlist-missing.json` (1,518 B) | YouTube Music Innertube | `POST …/browse` with `browseId: "VL" + <bogus>` — `microformatDataRenderer { noindex: true }`, no title (definitive `unavailable`) |
| `ytweb-playlist.json` (4,765,394 B) | YouTube Web Innertube | `POST https://www.youtube.com/youtubei/v1/browse`, JSON body `{ context: { client: { clientName: "WEB", … } }, browseId: "VL<large>" }` — page 1: 100 lockups + continuation token |
| `ytweb-playlist-continuation.json` (3,796,179 B) | YouTube Web Innertube | same URL, JSON body `{ context: WEB, continuation: <token from page 1> }` — 100 lockups, no further token |
| `ytweb-playlist-small.json` (402,147 B) | YouTube Web Innertube | `POST …/browse` with `browseId: "VL<small>"` — 7 lockups, empty description |
| `ytweb-playlist-missing.json` (33,639 B) | YouTube Web Innertube | `POST …/browse` with `browseId: "VL" + <bogus>` — `alertRenderer` ERROR "The playlist does not exist." (definitive `unavailable`) |
| `invidious-playlist.json` (246,452 B) | Invidious | `GET https://invidious.f5.si/api/v1/playlists/<large>` — full 200-video listing in one page (`videoCount: 200`, no `nextpage`) |
| `invidious-playlist-missing.json` (54 B) | Invidious | `GET https://invidious.f5.si/api/v1/playlists/<bogus>` → **HTTP 404** `{"error":"Could not extract playlistSidebarRenderer."}` (definitive `unavailable`; rotation stops) |
| `piped-playlist.json` (2,171 B) | Piped | `GET https://pipedapi.ducks.party/playlists/<large>` — real but degraded: `videos: 200`, `relatedStreams: []`, `nextpage: null` (metadata without entries → tier kind `empty`, chain falls through) |
| `piped-playlist-missing.json` (1,303 B) | Piped | `GET https://pipedapi.ducks.party/playlists/<bogus>` → `ContentNotAvailableException` envelope (definitive `unavailable`) |
| `piped-playlist-entries.json` (14,366 B) | Piped | **Constructed, not captured**: playlist metadata copied from `piped-playlist.json` (`videos` set to the entry count) plus the 20 stream items from `piped-search.json`. No live Piped instance returned playlist entries on the capture date, so the success path needs a synthetic listing — the real capture stays as the degraded-instance evidence |

Other 2026-09-29 observations: `yewtu.be` answered the bogus playlist id with
HTTP 200 HTML instead of 404, so it fails in the parse stage (the chain falls
through to the next instance/tier) — `invidious.f5.si` supplied the definitive
404 capture. Playlist fixtures total ~14.8 MB; they are byte-exact captures
except for the single constructed Piped listing noted above.
