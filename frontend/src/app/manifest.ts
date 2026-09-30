import type { MetadataRoute } from "next";

/**
 * The Web App Manifest (M13; spec `pwa` — "Installable application identity").
 *
 * Served as Next's typed metadata route (`/manifest.webmanifest`) rather than a
 * hand-maintained JSON file in `public/`: the object is type-checked, it sits next
 * to the icon it declares, and there is no second place to update when the app's
 * name changes.
 *
 * Every field here is an install decision, so each one is stated rather than
 * defaulted:
 *
 * - `id` is the application's stable identity. Chrome uses it to decide whether a
 *   launch is the same installed app; a manifest without one falls back to
 *   `start_url`, which is fine today and surprising after a URL change.
 * - `start_url` and `scope` are the site root, so an installed copy covers every
 *   route Spotivibe has and nothing else.
 * - `display: standalone` is the whole point of installing: no browser chrome, and
 *   the app fills the window it is given.
 * - `orientation: "any"` is explicit rather than omitted. The default is `any`, but
 *   a manifest whose orientation is implicit is a manifest nobody can read, and
 *   this app is genuinely usable in both.
 * - The colors are DESIGN.md tokens, not new brand decisions: `#000000` is
 *   `--color-void-black` (the top bar and the app's black) and `#121212` is
 *   `--color-carbon` (the page background), so the splash screen matches the first
 *   painted frame.
 * - Icons: the SVG the app already ships, two raster sizes for launchers that want
 *   them, and a maskable icon whose mark sits inside the safe zone. All of them are
 *   generated from the same mark by `scripts/generate-icons.mjs`, so the home
 *   screen and the favicon cannot drift apart.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Spotivibe",
    short_name: "Spotivibe",
    description: "Local-first music discovery and playback.",
    lang: "en",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: "#000000",
    background_color: "#121212",
    categories: ["music", "entertainment"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
