import type { NextConfig } from "next";

/**
 * The response security policy (M14; spec `security` — "Response security policy").
 *
 * Declared once, here, rather than per route or behind a middleware wrapper: this is
 * the only place that reaches every response — pages, `/_next/static/*`, the manifest,
 * and the service worker file — with no runtime hook a future route could bypass.
 *
 * **Every origin below is derived from the code, not from a template.** The client
 * contacts exactly two third-party origins:
 *
 * - `www.youtube.com` — the IFrame Player API script (`src/player/ytApi.ts`) and the
 *   embed frame the API creates (no `host` player variable is set, so the default
 *   `https://www.youtube.com/embed/...` frame is what loads). This is the one
 *   third-party frame the application depends on for playback.
 *
 * The image origins are a different kind of claim and are listed separately below.
 *
 * The provider origins (`music.youtube.com`, `invidious.f5.si`, `yewtu.be`, the
 * Piped API hosts) are deliberately **absent**: they are contacted by the route
 * handlers in Node, never by the browser, so permitting them in a browser policy
 * would grant the page access it does not use.
 *
 * `tests/security-policy.test.ts` fails on a host that the client uses and the policy
 * does not permit, and on a host the policy permits and nothing uses.
 */
const CLIENT_SCRIPT_ORIGINS = ["https://www.youtube.com"];
const CLIENT_FRAME_ORIGINS = ["https://www.youtube.com"];

/**
 * Image origins the browser is permitted to load.
 *
 * **M23 correction.** This list previously read `["https://i.ytimg.com", "data:"]` on
 * the stated grounds that `i.ytimg.com` serves "track, album, and artist artwork".
 * That was false against real traffic, and the consequence was severe: the policy
 * refused the host the providers actually return, so **every artist image failed to
 * load in production**.
 *
 * `i.ytimg.com` is only the *fallback* `pickArtwork()` constructs when a tier
 * supplied no artwork at all (`src/server/music/normalize.ts`). Every artwork URL a
 * provider really returns is passed through verbatim, and those come from
 * `yt3.googleusercontent.com` — 84 occurrences across the five captured fixtures in
 * `tests/fixtures/providers/`.
 *
 * Why this went unnoticed: the policy's own test derived the expected origins by
 * scanning `src/**` **source text**, and provider artwork never appears as a string
 * in our code. The detector was structurally incapable of observing the defect it
 * existed to prevent, so its green result was not evidence. It now reads the captured
 * fixtures, which is where the truth actually lives.
 *
 * The browser-side evidence for the mechanism, measured rather than assumed: the
 * URLs are valid (HTTP 200 `image/jpeg`, and 120x120 when navigated to directly), and
 * with one variable changed in one browser, this exact `img-src` fails to load them
 * while the same list plus `yt3` loads them.
 */
/**
 * Image origins the browser is permitted to load.
 *
 * **M23 correction.** This list previously read `["https://i.ytimg.com", "data:"]` on
 * the stated grounds that `i.ytimg.com` serves "track, album, and artist artwork".
 * That was false against real traffic, and the consequence was severe: the policy
 * refused four of the five hosts the application actually requests artwork from, so
 * **most artist, album and track images failed to load in production** while every
 * status code stayed 200.
 *
 * The hosts are derived from the captured provider payloads in
 * `tests/fixtures/providers/`, read from the keys the providers really extract
 * (`videoThumbnails`, `thumbnails`, `thumbnail`). Measured across those fixtures:
 *
 * | origin | occurrences | role |
 * |---|---|---|
 * | `i.ytimg.com` | 291 | YouTube video thumbnails; also the fallback `pickArtwork` constructs |
 * | `yt3.googleusercontent.com` | 63 | artist/channel artwork from Innertube |
 * | `yt3.ggpht.com` | 26 | channel avatars returned inside thumbnail payloads |
 * | `invidious.f5.si` | 1980 | Invidious **proxied** thumbnails |
 * | `piped-proxy.ducks.party` | 40 | Piped **proxied** thumbnails |
 *
 * The two proxy hosts are the reason the old comment was not merely incomplete but
 * wrong in its reasoning. It claimed provider origins are "contacted by the route
 * handlers in Node, never by the browser". That is true of the provider **APIs** and
 * false of provider **artwork**: `providers/invidious.ts` and `providers/piped.ts`
 * hand the browser image URLs pointing at the instance itself
 * (`https://invidious.f5.si/vi/<videoId>/maxres.jpg`), so those hosts are genuinely
 * browser image origins. They are permitted in `img-src` only, and
 * `tests/security-policy.test.ts` keeps them out of `script-src`, `frame-src` and
 * `connect-src`, where a provider host would be a real grant of access.
 *
 * `yewtu.be` is included because it is the other default Invidious instance
 * (`providers/invidious.ts` `DEFAULT_INSTANCES`) and serves the same proxied
 * thumbnails; whichever instance answers a request, its artwork must render.
 *
 * **Known residual, stated rather than hidden.** A CSP header is static while the
 * Invidious instance list is configurable at runtime through
 * `SPOTIVIBE_INVIDIOUS_INSTANCES`. An operator who configures a *different* instance
 * will get proxied artwork from a host this policy does not permit, so those images
 * will be refused — the same failure this milestone fixes, for a configuration that
 * is not the shipped default. The durable fix is to canonicalise artwork URLs to a
 * single permitted host at the normalization boundary (`videoId` is already on every
 * track, and `pickArtwork` already constructs the canonical fallback). That is a
 * cross-provider change with real resolution trade-offs and is deliberately not
 * smuggled into this milestone.
 */
const CLIENT_IMAGE_ORIGINS = [
  "https://i.ytimg.com",
  "https://yt3.googleusercontent.com",
  "https://yt3.ggpht.com",
  "https://invidious.f5.si",
  "https://yewtu.be",
  "https://piped-proxy.ducks.party",
  "data:",
];

/**
 * Build the policy.
 *
 * Development differs from production in exactly one place: Next's development
 * runtime evaluates generated code, which a production build does not. The
 * difference is asserted rather than assumed — `tests/security-policy.test.ts`
 * requires the production policy to contain no `unsafe-eval`.
 */
function contentSecurityPolicy(isProduction: boolean): string {
  const scriptSrc = [
    "'self'",
    ...CLIENT_SCRIPT_ORIGINS,
    // DEBT: inline script is permitted because the App Router bootstraps hydration with
    // inline payload scripts that are not enumerable at config time. Removing it needs
    // per-request nonces, which means a middleware that mints one — a build and
    // deployment change, deliberately not taken in this milestone. What this directive
    // costs, stated plainly: inline script is permitted, so an injected inline <script>
    // would run. What it still blocks is *remote* script, because `script-src` names the
    // hosts above; that protection comes from the host list, not from this entry.
    "'unsafe-inline'",
    ...(isProduction ? [] : ["'unsafe-eval'"]),
  ];
  const styleSrc = [
    "'self'",
    // DEBT: Tailwind's runtime and the shell's inline style attributes are not
    // nonce-plumbed. Same follow-up as above.
    "'unsafe-inline'",
  ];
  return [
    "default-src 'self'",
    // Every <form> in this application is a dialog that calls preventDefault, so no
    // submission ever leaves the page — and that is the real invariant, not "there are
    // no forms", which was the first version's claim and was wrong: there are four.
    // `security-policy.test.ts` holds the invariant by asserting each form prevents the
    // default, so a future form that forgets fails a test rather than silently
    // exfiltrating whatever it contains.
    "form-action 'none'",
    "object-src 'none'",
    // Frames are the player's own; this app never frames another site, so anything
    // beyond the player host is refused.
    `frame-src 'self' ${CLIENT_FRAME_ORIGINS.join(" ")}`,
    "frame-ancestors 'none'",
    `img-src 'self' ${CLIENT_IMAGE_ORIGINS.join(" ")}`,
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    // Every client-side request is to the application's own API surface; the provider
    // calls happen server-side and never appear here.
    "connect-src 'self'",
    // The player fetches its own media inside its own frame, under its own policy.
    "media-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Hardening headers, declared once and applied to every response.
 *
 * `X-Frame-Options` is kept alongside the policy's `frame-ancestors` because it is the
 * instruction older browsers still honour, and a hardening header that half the
 * installed base ignores is not doing the job it claims.
 */
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: (isProduction: boolean) => contentSecurityPolicy(isProduction),
  },
  { key: "X-Content-Type-Options", value: () => "nosniff" },
  // `strict-origin-when-cross-origin`, NOT `no-referrer`. The `playback` spec of record
  // requires that the player "SHALL NOT suppress the page referrer", and its
  // attribution links deliberately carry no `referrerPolicy` for that reason. A
  // response-level `no-referrer` would suppress the referrer for exactly those
  // navigations, application-wide - the first version of this header did, and the
  // independent verification pass caught it. `strict-origin-when-cross-origin` withholds
  // the path and query of same-origin requests and sends nothing to third parties on a
  // cross-origin navigation from an `https` page, which is the strongest value that
  // leaves the attribution requirement intact.
  { key: "Referrer-Policy", value: () => "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: () => "DENY" },
  {
    key: "Permissions-Policy",
    value: () => "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: () => "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: () => "same-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    const isProduction = process.env.NODE_ENV === "production";
    return [
      {
        // One rule for everything the server can serve, including the service worker
        // file and the web app manifest: a header that only covers pages is a header
        // that misses the two files a browser fetches before it renders anything.
        source: "/:path*",
        headers: SECURITY_HEADERS.map(({ key, value }) => ({ key, value: value(isProduction) })),
      },
    ];
  },
};

export default nextConfig;
