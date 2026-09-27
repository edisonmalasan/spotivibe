#!/usr/bin/env node
/**
 * M3 task 7.1 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Drives a production build (`next start`) in headless Edge over the
 * Chrome DevTools Protocol, loads the real app page origin, and issues
 * `GET /api/search` from that page context to capture:
 *   1. a live search: status 200, canonical Track shape, safe diagnostics
 *      subset, shared Cache-Control header;
 *   2. an invalid request: structured 400, `invalid_query`, no-store;
 *   3. a repeat search within the TTL: server-side cache hit
 *      (`diagnostics.cached = true`) with identical tracks;
 *   4. the session's console errors (must be zero; the intentional 400
 *      probe's browser network log, if any, is classified separately).
 *
 * If the live search returns 503, the primary upstream is probed directly
 * from Node so the exact network failure is recorded for classification.
 *
 * Writes `results.json` next to this script (the change's `evidence/`
 * directory). Exit code 0 = every assertion passed.
 *
 * Usage:  node cdp-search-check.mjs   (with the production server already running)
 * Env:    SPOTIVIBE_ORIGIN (default http://localhost:3210)
 *         SPOTIVIBE_BROWSER_PATH (Edge/Chrome executable override)
 *         SPOTIVIBE_CDP_PORT  (default 9444)
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EVIDENCE_DIR = dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.SPOTIVIBE_ORIGIN ?? "http://localhost:3210";
const CDP_PORT = Number(process.env.SPOTIVIBE_CDP_PORT ?? 9444);

const QUERY = "daft punk get lucky";
const SEARCH_URL = `/api/search?q=${encodeURIComponent(QUERY)}&limit=10`;
const INVALID_URL = "/api/search?limit=10"; // no q → 400 probe

const BROWSER_CANDIDATES = [
  process.env.SPOTIVIBE_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

/** Canonical Track fields (ROADMAP §8.1) — nothing outside this set may appear. */
const CANONICAL_TRACK_KEYS = new Set([
  "id",
  "source",
  "providerId",
  "title",
  "artists",
  "album",
  "artwork",
  "durationSeconds",
  "category",
  "explicit",
  "language",
  "qualityScore",
  "capabilities",
]);
const SAFE_DIAGNOSTIC_KEYS = ["cached", "resultCount", "tier", "tiersTried"];
const RAW_KEYS = [
  "flexColumns",
  "musicResponsiveListItem",
  "musicShelfRenderer",
  "videoRenderer",
  "compactVideoRenderer",
  "musicThumbnailRenderer",
  "lengthText",
  "shortBylineText",
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const found = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("No Edge/Chrome executable found (set SPOTIVIBE_BROWSER_PATH).");
  return found;
}

/** Direct probe of the primary upstream — only used when the route reports 503. */
async function probeUpstream() {
  try {
    const response = await fetch(
      "https://music.youtube.com/youtubei/v1/search?prettyPrint=false",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "WEB_REMIX",
              clientVersion: "1.20250101.01.00",
              hl: "en",
              gl: "US",
            },
          },
          query: QUERY,
          params: "EgWKAQIIAQ%3D%3D",
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    return { reachable: response.ok, status: response.status };
  } catch (error) {
    return { reachable: false, error: String(error?.cause ?? error) };
  }
}

function pageFetchExpression(url, opts = "") {
  return `(() => {
    const started = performance.now();
    return (async () => {
      try {
        const response = await fetch(${JSON.stringify(url)}, { ${opts} });
        const text = await response.text();
        let body = null;
        try { body = JSON.parse(text); } catch { body = { unparseable: text.slice(0, 300) }; }
        return {
          ok: true,
          status: response.status,
          timeMs: Math.round(performance.now() - started),
          cacheControl: response.headers.get("cache-control"),
          contentType: response.headers.get("content-type"),
          body,
        };
      } catch (error) {
        return { ok: false, error: String(error), timeMs: Math.round(performance.now() - started) };
      }
    })();
  })()`;
}

async function main() {
  const results = {
    task: "7.1",
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    pageOrigin: `${ORIGIN}/`,
    query: QUERY,
    steps: [],
    requests: {},
    consoleErrors: [],
    expectedNetworkLogs: [],
    pass: false,
  };
  const step = (name, ok, detail = "") => {
    results.steps.push({ name, ok, detail: String(detail).slice(0, 500) });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    return ok;
  };

  let browser;
  let ws;
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  const profileDir = mkdtempSync(join(tmpdir(), "spotivibe-cdp-"));

  const closeAll = () => {
    try {
      ws?.close();
    } catch {}
    try {
      browser?.kill();
    } catch {}
    delay(300).then(() => {
      try {
        rmSync(profileDir, { recursive: true, force: true });
      } catch {}
    });
  };

  try {
    if (!(await waitForServer())) {
      throw new Error(
        `Production server not reachable at ${ORIGIN} — run "npm run build" then start it on PORT 3210 first.`,
      );
    }

    browser = spawn(
      findBrowser(),
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profileDir}`,
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--disable-extensions",
        "about:blank",
      ],
      { stdio: "ignore" },
    );

    await waitForJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const target = await newTarget(ORIGIN);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("CDP WebSocket connection failed"));
    });
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const handler = pending.get(message.id);
        if (!handler) return;
        pending.delete(message.id);
        if (message.error) handler.reject(new Error(`${message.method}: ${message.error.message}`));
        else handler.resolve(message.result);
      } else {
        for (const listener of listeners) listener(message);
      }
    };

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const on = (method, handler) =>
      listeners.push((message) => message.method === method && handler(message.params));
    const evaluate = async (expression) => {
      const response = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description ?? "evaluate failed");
      }
      return response.result.value;
    };
    const waitFor = async (description, expression, predicate, timeoutMs = 20000) => {
      const started = Date.now();
      let last = null;
      while (Date.now() - started < timeoutMs) {
        try {
          last = await evaluate(expression);
          if (predicate(last)) return last;
        } catch {
          /* navigation in flight — retry */
        }
        await delay(200);
      }
      throw new Error(`Timed out waiting for ${description} (last: ${JSON.stringify(last)})`);
    };

    // ---- console error capture ------------------------------------------
    on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        results.consoleErrors.push(
          `console.error: ${params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`,
        );
      }
    });
    on("Runtime.exceptionThrown", (params) => {
      results.consoleErrors.push(
        `exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`.slice(0, 300),
      );
    });
    on("Log.entryAdded", (params) => {
      if (params.entry.level !== "error") return;
      const entry = params.entry;
      const text = `log: ${entry.text}`.slice(0, 300);
      // The intentional 400 probe may produce a browser network log — classify
      // it separately instead of counting it as an application console error.
      if ((entry.url ?? "").includes("/api/search?limit=10")) {
        results.expectedNetworkLogs.push(`${text} [${entry.url}]`);
      } else {
        results.consoleErrors.push(text);
      }
    });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("DOM.enable");

    // ---- 0. real page origin --------------------------------------------
    await send("Page.navigate", { url: `${ORIGIN}/` });
    await waitFor("app shell main landmark", "!!document.querySelector('main')", Boolean);
    step("loaded the real app page origin", true, `${ORIGIN}/`);

    // ---- 1. live search from the page origin ----------------------------
    const live = await evaluate(pageFetchExpression(SEARCH_URL));
    results.requests.live = live;
    step(
      "GET /api/search returns 200 with cache headers",
      live.ok && live.status === 200 && live.cacheControl === "public, max-age=60",
      live.ok
        ? `status ${live.status}, cache-control "${live.cacheControl}", ${live.timeMs}ms`
        : `fetch failed: ${live.error}`,
    );

    const body = live.ok ? live.body : null;
    if (body && Array.isArray(body.tracks)) {
      const tracks = body.tracks;
      const canonicalOk =
        tracks.length > 0 &&
        tracks.length <= 10 &&
        tracks.every((track) => {
          const keys = Object.keys(track);
          return (
            keys.every((key) => CANONICAL_TRACK_KEYS.has(key)) &&
            /^youtube:[\w-]{11}$/.test(String(track.id)) &&
            track.source === "youtube" &&
            typeof track.providerId === "string" &&
            track.providerId.length > 0 &&
            typeof track.qualityScore === "number" &&
            Array.isArray(track.artists) &&
            track.artists.length > 0 &&
            track.capabilities?.stream === true &&
            track.capabilities?.offlineDownload === false
          );
        });
      step(
        "response contains only canonical Track fields (limit honored)",
        canonicalOk,
        `${tracks.length} tracks, first id ${tracks[0]?.id}`,
      );

      const diag = body.diagnostics ?? {};
      const diagOk =
        JSON.stringify(Object.keys(diag).sort()) === JSON.stringify([...SAFE_DIAGNOSTIC_KEYS].sort()) &&
        ["ytmusic", "ytweb", "invidious", "piped"].includes(diag.tier) &&
        diag.cached === false &&
        typeof diag.resultCount === "number" &&
        Array.isArray(diag.tiersTried) &&
        diag.tiersTried.every(
          (entry) =>
            JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(["outcome", "tier"]),
        );
      step(
        "diagnostics are the safe subset (tier ids/outcomes/cache state only)",
        diagOk,
        `tier ${diag.tier}, tiersTried ${JSON.stringify(diag.tiersTried)}, cached ${diag.cached}`,
      );

      const serialized = JSON.stringify(body);
      const leaked = RAW_KEYS.filter((key) => serialized.includes(key));
      step("no raw provider/renderer structures cross the API boundary", leaked.length === 0,
        leaked.length ? `leaked: ${leaked.join(", ")}` : `scanned for ${RAW_KEYS.length} raw key names`);

      results.summary = {
        tier: diag.tier,
        resultCount: diag.resultCount,
        firstTrack: tracks[0]
          ? {
              id: tracks[0].id,
              title: tracks[0].title,
              artists: tracks[0].artists,
              durationSeconds: tracks[0].durationSeconds ?? null,
              category: tracks[0].category,
            }
          : null,
        responseTimeMs: live.timeMs,
      };
    } else {
      step("response contains only canonical Track fields (limit honored)", false,
        `unexpected body: ${JSON.stringify(body).slice(0, 300)}`);
      step("diagnostics are the safe subset (tier ids/outcomes/cache state only)", false, "no body");
      step("no raw provider/renderer structures cross the API boundary", false, "no body");
    }

    if (live.ok && live.status === 503) {
      results.upstreamProbe = await probeUpstream();
      step(
        "live upstream reachable (classification when route reports 503)",
        false,
        `primary upstream probe: ${JSON.stringify(results.upstreamProbe)}`,
      );
    }

    // ---- 2. invalid request → structured 400 ----------------------------
    const invalid = await evaluate(pageFetchExpression(INVALID_URL));
    results.requests.invalid = invalid;
    step(
      "invalid request returns structured 400 invalid_query with no-store",
      invalid.ok &&
        invalid.status === 400 &&
        invalid.cacheControl === "no-store" &&
        invalid.body?.error?.code === "invalid_query" &&
        typeof invalid.body?.error?.message === "string" &&
        invalid.body.error.message.length > 0,
      invalid.ok
        ? `status ${invalid.status}, code ${invalid.body?.error?.code}, message "${invalid.body?.error?.message}"`
        : `fetch failed: ${invalid.error}`,
    );

    // ---- 3. repeat within TTL → server-side cache hit -------------------
    const repeat = await evaluate(
      pageFetchExpression(SEARCH_URL, `cache: "no-store"`),
    );
    results.requests.repeat = repeat;
    const sameTracks =
      repeat.ok &&
      Array.isArray(repeat.body?.tracks) &&
      Array.isArray(body?.tracks) &&
      JSON.stringify(repeat.body.tracks) === JSON.stringify(body.tracks);
    step(
      "repeat query within the TTL is served from the server cache",
      repeat.ok &&
        repeat.status === 200 &&
        repeat.body?.diagnostics?.cached === true &&
        sameTracks,
      repeat.ok
        ? `status ${repeat.status}, cached ${repeat.body?.diagnostics?.cached}, identical tracks: ${sameTracks}, ${repeat.timeMs}ms`
        : `fetch failed: ${repeat.error}`,
    );

    // ---- 4. console hygiene ---------------------------------------------
    step(
      "zero console errors during the whole session",
      results.consoleErrors.length === 0,
      results.consoleErrors.join(" | ") ||
        `none${results.expectedNetworkLogs.length ? ` (${results.expectedNetworkLogs.length} expected network log(s) from the 400 probe)` : ""}`,
    );

    results.pass = results.steps.every((s) => s.ok);
  } catch (error) {
    results.error = String(error?.stack ?? error);
    console.error(`EVIDENCE RUN FAILED: ${results.error}`);
  } finally {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(EVIDENCE_DIR, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
    closeAll();
  }

  console.log(`\nresults.json written — pass=${results.pass}`);
  process.exit(results.pass ? 0 : 1);
}

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(`${ORIGIN}/`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await delay(500);
  }
  return false;
}

async function waitForJson(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await delay(250);
  }
  throw new Error(`CDP endpoint not reachable: ${url}`);
}

async function newTarget(url) {
  const endpoint = `http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`;
  let response = await fetch(endpoint, { method: "PUT" }).catch(() => undefined);
  if (!response || !response.ok) response = await fetch(endpoint);
  if (!response.ok) throw new Error(`Could not create CDP target: HTTP ${response.status}`);
  return response.json();
}

main();
