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
 * - `i.ytimg.com` — track, album, and artist artwork.
 *
 * The provider origins (`music.youtube.com`, `invidious.f5.si`, `yewtu.be`, the
 * Piped API hosts) are deliberately **absent**: they are contacted by the route
 * handlers in Node, never by the browser, so permitting them in a browser policy
 * would grant the page access it does not use.
 *
 * `tests/security-policy.test.ts` reads the origins out of `src/**` and fails on a
 * host that the client uses and the policy does not permit, and on a host the policy
 * permits and nothing in the client uses.
 */
const CLIENT_SCRIPT_ORIGINS = ["https://www.youtube.com"];
const CLIENT_FRAME_ORIGINS = ["https://www.youtube.com"];
const CLIENT_IMAGE_ORIGINS = ["https://i.ytimg.com", "data:"];

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
    // DEBT: inline script is required because the App Router bootstraps hydration
    // with inline payload scripts that are not enumerable at config time. Removing it
    // needs per-request nonces, which means a middleware that mints one — a build and
    // deployment change, deliberately not taken in this milestone. Until then this
    // directive blocks *remote* script injection, which is the vector that matters
    // for an application with no third-party script bundles.
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
    // A form submission anywhere would exfiltrate data; there are none, and this says so.
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
  { key: "Referrer-Policy", value: () => "no-referrer" },
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
