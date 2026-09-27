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
