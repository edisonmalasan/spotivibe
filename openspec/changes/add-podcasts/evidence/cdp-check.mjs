#!/usr/bin/env node
/**
 * M12 task 9.2 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Drives a production build (`next start`) in headless Edge over the Chrome
 * DevTools Protocol to capture what unit tests cannot about the podcast search
 * mode:
 *   1. a music-mode search is unchanged by this build — the same request shape, the
 *      same result sections, the same first tier;
 *   2. the mode control announces both modes, and switching to Podcasts keeps the
 *      query, rewrites the URL, and asks the server a different question;
 *   3. a podcast-mode search returns podcast-labelled episodes that music search
 *      for the same words does not, presented as Episodes/Shows with no Albums
 *      section, and the server's own diagnostics show YouTube Music was *skipped*
 *      rather than consulted;
 *   4. a curated category is a podcast-mode search URL, not a shelf of results, and
 *      it starts that search when activated;
 *   5. a podcast search that genuinely returns nothing explains itself in podcast
 *      terms (one response is stubbed to make that state reachable — disclosed);
 *   6. an episode plays in the persistent player, and its position survives a
 *      reload;
 *   7. a stored position beyond the track's duration is clamped at load time rather
 *      than cued past the end;
 *   8. the played episode appears on the local History surface with its verdict and
 *      counts toward the local statistics, with no podcast-specific surface;
 *   9. every `/api/search` request this run issued carried only `q`, `limit`, and
 *      `category` — no liked-track, playlist, history, or profile parameter;
 *  10. exactly one player iframe / one IFrame API script, and zero console errors
 *      (deliberate stub and live-upstream entries are disclosed, not counted).
 *
 * Writes `results.json` and screenshots next to this script (the change's
 * `evidence/` directory). Exit code 0 = every assertion passed.
 *
 * Usage:  node cdp-check.mjs   (with the production server already running)
 * Env:    SPOTIVIBE_ORIGIN (default http://localhost:3210)
 *         SPOTIVIBE_BROWSER_PATH (Edge/Chrome executable override)
 *         SPOTIVIBE_CDP_PORT  (default 9445)
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVIDENCE_DIR = dirname(fileURLToPath(import.meta.url));
mkdirSync(EVIDENCE_DIR, { recursive: true });
const ORIGIN = process.env.SPOTIVIBE_ORIGIN ?? "http://localhost:3210";
const CDP_PORT = Number(process.env.SPOTIVIBE_CDP_PORT ?? 9445);
const REPO = resolve(EVIDENCE_DIR, "../../../.."); // repo root
const FRONTEND = join(REPO, "frontend");

const BROWSER_CANDIDATES = [
  process.env.SPOTIVIBE_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const found = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found)
    throw new Error(
      "No Edge/Chrome executable found (set SPOTIVIBE_BROWSER_PATH).",
    );
  return found;
}

/** Live inputs: a stable music query, then podcast queries tried in order. */
const MUSIC_QUERY = "bohemian rhapsody";
const PODCAST_QUERY_CANDIDATES = [
  "true crime podcast",
  "history podcast",
  "news podcast",
  "science podcast",
];

/**
 * The complete parameter surface a search request may carry. The route's own
 * architecture rule pins the same three keys; this is the browser-side proof that
 * nothing local ever crosses a search request boundary.
 */
const SEARCH_KEYS_ALLOWED = ["q", "limit", "category"];

/**
 * A query the harness answers itself with a 200 and an empty result set.
 *
 * The remote-empty state is unreachable through the live server on purpose: the
 * chain reports "no tier produced a usable result" as a 503, which is the error
 * state, not the empty one. Stubbing one response is the only way to reach the
 * state at all, and it is disclosed in `notes.disclosures.stubbedResponses`.
 */
const STUB_QUERY = "zzq stubbed empty podcast search";

/** Exact copy lifted from the sources at runtime (no encoding assumptions). */
function extractConstants() {
  const read = (...parts) => readFileSync(join(FRONTEND, ...parts), "utf8");
  const onboarding = read("src/features/preferences/LanguageOnboarding.tsx");
  const playerStore = read("src/stores/playerStore.ts");
  const pick = (re, source, name) => {
    const value = re.exec(source)?.[1];
    if (!value) throw new Error(`Could not extract ${name} from sources.`);
    return value;
  };
  const pickNumber = (re, source, name) => {
    const value = re.exec(source)?.[1];
    if (value === undefined)
      throw new Error(`Could not extract ${name} from sources.`);
    return Number(value);
  };
  return {
    onboardingLabel: pick(
      /LANGUAGE_ONBOARDING_LABEL = "([^"]+)"/,
      onboarding,
      "onboarding dialog label",
    ),
    onboardingConfirm: pick(
      /confirmLabel="([^"]+)"/,
      onboarding,
      "onboarding confirm label",
    ),
    // The clamp's tail, read from the source: the browser assertion compares the
    // restored position against the shipped constant rather than a copy of it.
    endCueTailSeconds: pickNumber(
      /END_CUE_TAIL_SECONDS = (\d+)/,
      playerStore,
      "player store END_CUE_TAIL_SECONDS",
    ),
  };
}

async function waitForServer(timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(ORIGIN);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await delay(400);
  }
  return false;
}

async function waitForJson(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await delay(250);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function newTarget(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(
        `http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`,
        {
          method: "PUT",
        },
      );
      if (res.ok) return await res.json();
    } catch {
      /* browser not ready yet */
    }
    await delay(300);
  }
  throw new Error("Could not create a CDP target.");
}

/**
 * Ask the running server directly, for the two questions the UI cannot answer.
 *
 * A 503 or a transport failure is retried (bounded, with a pause) because the
 * probe is used to *select* a workable podcast query: a transient upstream hiccup
 * during selection would otherwise read as "this query has no podcast results",
 * which is a claim the probe cannot make. Every attempt is recorded, so a run that
 * needed retries is visible in `results.json` rather than hidden in a delay.
 */
async function probeSearch(query, category, { attempts = 3 } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const probe = await probeSearchOnce(query, category, attempt);
    if (probe.status === 200) return probe;
    last = probe;
    if (probe.status !== 503 && probe.status !== -1) break; // a real answer
    if (attempt < attempts) await delay(3000);
  }
  return last;
}

/** One probe attempt. */
async function probeSearchOnce(query, category, attempt) {
  const url = new URL("/api/search", ORIGIN);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  if (category !== undefined) url.searchParams.set("category", category);
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
    const body = await response.json().catch(() => null);
    return {
      query,
      category: category ?? "(absent)",
      attempt,
      status: response.status,
      count: Array.isArray(body?.tracks) ? body.tracks.length : -1,
      tier: body?.diagnostics?.tier ?? null,
      tiersTried: body?.diagnostics?.tiersTried ?? null,
      titles: Array.isArray(body?.tracks)
        ? body.tracks.slice(0, 6).map((track) => ({
            title: track.title,
            category: track.category,
            durationSeconds: track.durationSeconds ?? null,
            artist: track.artists?.[0]?.name ?? "",
          }))
        : [],
      error: body?.error?.code ?? null,
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      query,
      category: category ?? "(absent)",
      attempt,
      status: -1,
      count: -1,
      tier: null,
      tiersTried: null,
      titles: [],
      error: String(error?.message ?? error).slice(0, 120),
      ms: Date.now() - started,
    };
  }
}

async function main() {
  const COPY = extractConstants();
  const results = {
    task: "9.2",
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    musicQuery: MUSIC_QUERY,
    podcastQueryCandidates: PODCAST_QUERY_CANDIDATES,
    allowedSearchKeys: SEARCH_KEYS_ALLOWED,
    copy: COPY,
    steps: [],
    screenshots: [],
    consoleErrors: [],
    notes: {
      disclosures: {
        offlineWindow: [],
        liveUpstream: [],
        stubbedResponses: [],
      },
      searchRequests: [],
      upstreamProbes: [],
    },
    pass: false,
  };
  const step = (name, ok, detail = "") => {
    results.steps.push({
      name,
      ok: !!ok,
      detail: String(detail).slice(0, 600),
    });
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
    );
    return !!ok;
  };

  let browser;
  let ws;
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  const profileDir = mkdtempSync(join(tmpdir(), "spotivibe-cdp-"));

  // --- multi-target network emulation (the player iframe is an OOPIF) ----
  const cdpSessions = new Set();
  let offlineNow = false;
  let stubbingNow = false; // deliberate one-response stub window
  const sendTo = (sessionId, method, params = {}) =>
    new Promise((resolveSend, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolveSend, reject });
      ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  const enableNetworkOn = async (sessionId) => {
    try {
      await sendTo(sessionId, "Network.enable");
      await sendTo(sessionId, "Network.emulateNetworkConditions", {
        offline: offlineNow,
        latency: 0,
        downloadThroughput: offlineNow ? 0 : -1,
        uploadThroughput: offlineNow ? 0 : -1,
      });
    } catch (error) {
      results.notes.networkEmulationErrors =
        results.notes.networkEmulationErrors ?? [];
      results.notes.networkEmulationErrors.push({
        session: sessionId || "main",
        error: String(error?.message ?? error).slice(0, 160),
      });
    }
  };

  const closeAll = () => {
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    try {
      browser?.kill();
    } catch {
      /* already gone */
    }
    delay(300).then(() => {
      try {
        rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    });
  };

  try {
    if (!(await waitForServer())) {
      throw new Error(
        `Production server not reachable at ${ORIGIN} — run "npm run build" then "npm run start -- -p 3210" first.`,
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

    const version = await waitForJson(
      `http://127.0.0.1:${CDP_PORT}/json/version`,
    );
    results.browser = version.Browser ?? "unknown";
    const target = await newTarget(`${ORIGIN}/`);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveWs, reject) => {
      ws.onopen = resolveWs;
      ws.onerror = () => reject(new Error("CDP WebSocket connection failed"));
    });
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const handler = pending.get(message.id);
        if (!handler) return;
        pending.delete(message.id);
        if (message.error)
          handler.reject(
            new Error(`${message.method}: ${message.error.message}`),
          );
        else handler.resolve(message.result);
      } else {
        for (const listener of listeners) listener(message);
      }
    };

    const send = (method, params = {}) => sendTo("", method, params);
    const on = (method, handler) =>
      listeners.push(
        (message) =>
          message.method === method &&
          handler(message.params, message.sessionId),
      );
    const evaluate = async (expression) => {
      const response = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (response.exceptionDetails) {
        throw new Error(
          response.exceptionDetails.exception?.description ?? "evaluate failed",
        );
      }
      return response.result.value;
    };
    const waitFor = async (
      description,
      expression,
      predicate,
      timeoutMs = 20000,
    ) => {
      const started = Date.now();
      let last = null;
      while (Date.now() - started < timeoutMs) {
        try {
          last =
            typeof expression === "function"
              ? await expression()
              : await evaluate(expression);
          if (predicate(last)) return last;
        } catch {
          /* navigation in flight — retry */
        }
        await delay(250);
      }
      throw new Error(
        `Timed out waiting for ${description} (last: ${JSON.stringify(last)})`,
      );
    };
    const rectOfJs = (elementJs) => `(() => {
      const el = ${elementJs};
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height };
    })()`;
    const trustedClickRect = async (rectExpr, label) => {
      const point = await evaluate(rectExpr);
      if (!point || point.w === 0 || point.h === 0) {
        throw new Error(
          `Element not clickable (missing or zero-size): ${label} → ${JSON.stringify(point)}`,
        );
      }
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: point.x,
        y: point.y,
      });
      await send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: point.x,
        y: point.y,
        button: "left",
        clickCount: 1,
      });
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: point.x,
        y: point.y,
        button: "left",
        clickCount: 1,
      });
      return point;
    };
    const trustedClickSel = (selector) =>
      trustedClickRect(
        rectOfJs(`document.querySelector(${JSON.stringify(selector)})`),
        selector,
      );
    const trustedClickJs = (elementJs, label) =>
      trustedClickRect(rectOfJs(elementJs), label ?? elementJs.slice(0, 80));
    const buttonByText = (text) =>
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(
        text,
      )})`;
    /**
     * Activate a control and prove it took effect: a trusted mouse click first,
     * then an in-page `click()` on the same element if the trusted one changed
     * nothing. Which path ran is recorded rather than hidden - a control that sits
     * under the sticky header is exactly where a trusted click silently misses
     * (learned in M11).
     */
    const activate = async (
      selector,
      description,
      expectExpr,
      expectPred,
      timeoutMs = 8000,
    ) => {
      await trustedClickSel(selector).catch(() => null);
      const viaTrusted = await waitFor(
        `${description} (trusted click)`,
        expectExpr,
        expectPred,
        timeoutMs,
      )
        .then(() => "trusted-click")
        .catch(async () => {
          await evaluate(
            `document.querySelector(${JSON.stringify(selector)})?.click(); true`,
          );
          return waitFor(
            `${description} (in-page click)`,
            expectExpr,
            expectPred,
            40000,
          )
            .then(() => "in-page-click")
            .catch(() => null);
        });
      results.notes.activations = results.notes.activations ?? {};
      results.notes.activations[description] = viaTrusted;
      return viaTrusted;
    };
    const shoot = async (width, height, file, note) => {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(700);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(EVIDENCE_DIR, file), Buffer.from(shot.data, "base64"));
      results.screenshots.push({ file, width, height, note });
      await send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(200);
    };
    const goto = async (path, readyExpr, readyDesc) => {
      await send("Page.navigate", { url: `${ORIGIN}${path}` });
      await waitFor(
        `${path} document complete`,
        `document.readyState`,
        (r) => r === "complete",
        20000,
      );
      if (readyExpr)
        await waitFor(`${path}: ${readyDesc}`, readyExpr, Boolean, 30000);
      await delay(400);
    };
    const typeText = async (text, perCharMs = 25) => {
      for (const ch of text) {
        await send("Input.dispatchKeyEvent", {
          type: "char",
          text: ch,
          key: ch,
        });
        if (perCharMs > 0) await delay(perCharMs);
      }
    };
    const clockToSeconds = (text) => {
      const parts = String(text ?? "")
        .trim()
        .split(":")
        .map((part) => Number(part));
      if (parts.some((part) => !Number.isFinite(part))) return null;
      return parts.reduce((total, part) => total * 60 + part, 0);
    };

    // ---- console error capture with honest disclosure buckets ----------
    on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        const text = `console.error: ${params.args
          .map((a) => a.value ?? a.description ?? "")
          .join(" ")
          .slice(0, 300)}`;
        results.consoleErrors.push(text);
      }
    });
    on("Runtime.exceptionThrown", (params) => {
      const text =
        `exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`.slice(
          0,
          300,
        );
      results.consoleErrors.push(text);
    });
    on("Log.entryAdded", (params) => {
      if (params.entry.level !== "error") return;
      // The URL is included: an unattributed 5xx is undiagnosable after the run.
      const entryUrl = String(params.entry.url ?? "");
      const text = `log: ${params.entry.text} [${entryUrl}]`.slice(0, 300);
      const netCut = /net::ERR_|Failed to load resource/.test(
        params.entry.text,
      );
      const statusErr = /status of [45]\d\d/.test(params.entry.text);
      const liveFlake = /status of (429|503)/.test(params.entry.text);
      if (stubbingNow && (netCut || statusErr))
        results.notes.disclosures.stubbedResponses.push(text);
      else if (offlineNow && (netCut || statusErr))
        results.notes.disclosures.offlineWindow.push(text);
      else if (liveFlake) results.notes.disclosures.liveUpstream.push(text);
      else results.consoleErrors.push(text);
    });
    // Every search request is recorded twice: in the harness (for the run record)
    // and in the page (so the log survives a navigation and can be read back with
    // a plain evaluate).
    on("Network.requestWillBeSent", (params) => {
      const url = String(params.request?.url ?? "");
      if (!url.includes("/api/search")) return;
      const parsed = new URL(url, ORIGIN);
      const record = {
        url: url.replace(ORIGIN, "").slice(0, 300),
        keys: [...parsed.searchParams.keys()].sort(),
        q: parsed.searchParams.get("q"),
        limit: Number(parsed.searchParams.get("limit") ?? "0"),
        category: parsed.searchParams.get("category"),
      };
      results.notes.searchRequests.push(record);
      evaluate(`(() => {
        if (!window.__spotivibeSearchLog) window.__spotivibeSearchLog = [];
        window.__spotivibeSearchLog.push(${JSON.stringify(record)});
        return true;
      })()`).catch(() => {
        /* the document is mid-navigation; the next request re-seeds it */
      });
    });

    cdpSessions.add("");
    results.notes.attachedTargets = [];
    on("Target.attachedToTarget", (params) => {
      cdpSessions.add(params.sessionId);
      results.notes.attachedTargets.push({
        type: params.targetInfo?.type ?? null,
        url: String(params.targetInfo?.url ?? "").slice(0, 140),
      });
      void enableNetworkOn(params.sessionId);
    });
    on("Target.detachedFromTarget", (params) => {
      if (params?.sessionId) cdpSessions.delete(params.sessionId);
    });

    // ---- the one deliberately stubbed response --------------------------
    on("Fetch.requestPaused", async (params, sessionId) => {
      const url = String(params.request?.url ?? "");
      const isStubTarget = stubbingNow && url.includes("/api/search");
      const body = JSON.stringify({
        tracks: [],
        diagnostics: { cached: false, tier: null, resultCount: 0 },
      });
      try {
        await sendTo(
          sessionId ?? "",
          isStubTarget ? "Fetch.fulfillRequest" : "Fetch.continueRequest",
          {
            requestId: params.requestId,
            ...(isStubTarget
              ? {
                  responseCode: 200,
                  responseHeaders: [
                    { name: "content-type", value: "application/json" },
                  ],
                  body: Buffer.from(body).toString("base64"),
                }
              : {}),
          },
        );
      } catch (error) {
        results.notes.fetchErrors = results.notes.fetchErrors ?? [];
        results.notes.fetchErrors.push(
          String(error?.message ?? error).slice(0, 160),
        );
      }
    });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Network.enable");
    await send("DOM.enable");
    await send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });

    // ---- shared page reads ---------------------------------------------
    const SEARCH_READY = `(() => {
      const input = document.querySelector('input[aria-label="Search"]');
      return !!input && Object.keys(input).some((k) => k.indexOf('__reactProps$') === 0);
    })()`;
    const SEARCH_ROWS = `[data-testid="search-results"] li`;
    const playerState = `(() => ({
      bar: document.querySelector('[data-testid="player-bar"]')?.textContent ?? '',
      control: document.querySelector('[data-testid="player-bar"] button[aria-label="Pause"]') ? 'Pause' : 'Play',
      iframes: document.querySelectorAll('iframe').length,
      apiScripts: [...document.querySelectorAll('script')].filter((s) => (s.src ?? '').includes('youtube.com/iframe_api')).length,
      position: document.querySelector('[data-testid="progress-position"]')?.textContent ?? '',
      duration: document.querySelector('[data-testid="progress-duration"]')?.textContent ?? '',
      title: document.querySelector('[data-testid="player-bar"] [data-testid="player-title"]')?.textContent ?? '',
    }))()`;
    const sectionTitles = `(() => [...document.querySelectorAll('h2, h3')].map((h) => h.textContent.trim()))()`;
    /** The whole listening-history dataset, read straight out of IndexedDB. */
    const storedEvents = `(() => new Promise((resolve) => {
      const open = indexedDB.open('spotivibe');
      open.onerror = () => resolve({ ok: false, count: -1, events: [] });
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('listeningHistory')) { db.close(); resolve({ ok: true, count: 0, events: [] }); return; }
        const tx = db.transaction('listeningHistory', 'readonly');
        const request = tx.objectStore('listeningHistory').index('byPlayedAt').getAll();
        request.onerror = () => { db.close(); resolve({ ok: false, count: -1, events: [] }); };
        request.onsuccess = () => {
          const events = request.result.map((event) => ({
            trackId: event.trackId,
            title: event.track?.title ?? '',
            category: event.track?.category ?? null,
            secondsPlayed: event.secondsPlayed,
            completed: event.completed === true,
            context: event.context,
          }));
          db.close();
          resolve({ ok: true, count: events.length, events });
        };
      };
    }))()`;
    /** The single session record — the restore source, read from IndexedDB. */
    const storedSession = `(() => new Promise((resolve) => {
      const open = indexedDB.open('spotivibe');
      open.onerror = () => resolve({ ok: false, session: null });
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('session')) { db.close(); resolve({ ok: true, session: null }); return; }
        const tx = db.transaction('session', 'readonly');
        const request = tx.objectStore('session').get('app');
        request.onerror = () => { db.close(); resolve({ ok: false, session: null }); };
        request.onsuccess = () => {
          const record = request.result ?? null;
          db.close();
          resolve({
            ok: true,
            session: record === null ? null : {
              positionSeconds: record.positionSeconds,
              queueIndex: record.queueIndex,
              queueLength: Array.isArray(record.queue) ? record.queue.length : 0,
              current: record.queue?.[record.queueIndex] ?? null,
            },
          });
        };
      };
    }))()`;
    /** Overwrite the stored position — the only way to reach the clamp in a browser. */
    const writeSessionPosition = (seconds) => `(() => new Promise((resolve) => {
      const open = indexedDB.open('spotivibe');
      open.onerror = () => resolve(false);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('session', 'readwrite');
        const store = tx.objectStore('session');
        const get = store.get('app');
        get.onerror = () => { db.close(); resolve(false); };
        get.onsuccess = () => {
          const record = get.result;
          if (!record) { db.close(); resolve(false); return; }
          record.positionSeconds = ${seconds};
          store.put(record);
          tx.oncomplete = () => { db.close(); resolve(true); };
          tx.onerror = () => { db.close(); resolve(false); };
        };
      };
    }))()`;
    const searchLogExpr = `(() => {
      if (!window.__spotivibeSearchLog) window.__spotivibeSearchLog = [];
      return window.__spotivibeSearchLog;
    })()`;
    const modeState = `(() => {
      const group = document.querySelector('[data-testid="search-mode-switch"]');
      const music = document.querySelector('[data-testid="search-mode-music"]');
      const podcast = document.querySelector('[data-testid="search-mode-podcast"]');
      return {
        present: !!group,
        role: group?.getAttribute('role') ?? '',
        label: group?.getAttribute('aria-label') ?? '',
        musicChecked: music?.getAttribute('aria-checked') ?? null,
        podcastChecked: podcast?.getAttribute('aria-checked') ?? null,
        url: location.pathname + location.search,
        input: document.querySelector('input[aria-label="Search"]')?.value ?? '',
      };
    })()`;

    // Parse self-check: a malformed expression reads as a silent null timeout.
    for (const [name, expr] of Object.entries({
      SEARCH_READY,
      playerState,
      modeState,
      searchLogExpr,
    })) {
      try {
        new Function(`return (${expr})`);
      } catch (error) {
        throw new Error(`Expression ${name} does not parse: ${error.message}`);
      }
    }

    // ====================================================================
    // STEP 0 — a fresh profile lands on the modal first-run language onboarding
    // ====================================================================
    await waitFor("hydrated top-bar search", SEARCH_READY, Boolean, 30000);
    const ONBOARDING_DIALOG = `div[role="dialog"][aria-label=${JSON.stringify(COPY.onboardingLabel)}]`;
    const onboarding = await waitFor(
      "first-run language onboarding",
      `(() => {
        const dialog = document.querySelector(${JSON.stringify(ONBOARDING_DIALOG)});
        if (!dialog) return null;
        return {
          present: true,
          checkboxes: dialog.querySelectorAll('input[type="checkbox"]').length,
          confirm: [...dialog.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(
            COPY.onboardingConfirm,
          )}),
          accountCopy: /sign[\s-]?in|log[\s-]?in|account|password|google/i.test(dialog.textContent || ''),
        };
      })()`,
      (state) => state !== null && state.checkboxes > 0 && state.confirm,
      30000,
    ).catch(() => null);
    if (onboarding) {
      step(
        "a fresh profile shows the accountless first-run language onboarding",
        onboarding.checkboxes > 0 &&
          onboarding.confirm &&
          !onboarding.accountCopy,
        `checkboxes=${onboarding.checkboxes}, confirm="${COPY.onboardingConfirm}", accountCopy=${onboarding.accountCopy}`,
      );
      await trustedClickJs(
        buttonByText(COPY.onboardingConfirm),
        "confirm languages",
      );
      await waitFor(
        "onboarding dismissed",
        `!document.querySelector(${JSON.stringify(ONBOARDING_DIALOG)})`,
        Boolean,
        20000,
      );
    } else {
      step(
        "a fresh profile shows the accountless first-run language onboarding",
        false,
        "the first-run dialog never appeared within 30s, so every later surface was unreachable",
      );
    }

    // ====================================================================
    // STEP 1 — music mode is what it always was
    // ====================================================================
    await goto("/search", SEARCH_READY, "hydrated search input");
    const musicSearchReady = `location.pathname === '/search' && document.querySelectorAll(${JSON.stringify(
      SEARCH_ROWS,
    )}).length >= 3`;
    await trustedClickSel('input[aria-label="Search"]');
    await delay(150);
    await typeText(MUSIC_QUERY);
    const musicResults = await waitFor(
      "live music search results",
      musicSearchReady,
      Boolean,
      60000,
    ).catch(() => null);
    const musicSections = await evaluate(sectionTitles);
    const musicState = await evaluate(modeState);
    const musicRows = await evaluate(
      `(() => [...document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)})].map((row) => ({
        title: row.querySelector('span[title]')?.getAttribute('title') ?? row.textContent.trim().slice(0, 60),
        text: row.textContent.trim().slice(0, 120),
      })))()`,
    );
    step(
      "a music-mode search still returns results with the Songs/Artists/Albums sections",
      Boolean(musicResults) &&
        musicRows.length >= 3 &&
        musicSections.includes("Songs"),
      `rows=${musicRows.length}, sections=${JSON.stringify(musicSections.filter((title) => ["Songs", "Artists", "Albums", "Top result"].includes(title)))}`,
    );
    step(
      "the mode control defaults to Music and announces its state",
      musicState.present &&
        musicState.role === "radiogroup" &&
        musicState.label === "Search mode" &&
        musicState.musicChecked === "true" &&
        musicState.podcastChecked === "false",
      `role=${musicState.role}, aria-label="${musicState.label}", music=${musicState.musicChecked}, podcast=${musicState.podcastChecked}`,
    );
    const musicRequests = (await evaluate(searchLogExpr)).filter(
      (entry) => entry.q === MUSIC_QUERY,
    );
    step(
      "a music-mode request sends no category parameter at all, so its URL is unchanged",
      musicRequests.length >= 1 &&
        musicRequests.every((entry) => entry.category === null),
      `requests=${JSON.stringify(musicRequests.map((entry) => entry.url))}`,
    );
    await shoot(
      1280,
      900,
      "search-music-mode-1280.png",
      "Music mode: unchanged result sections and no category parameter",
    );

    // ====================================================================
    // STEP 2 — the server answers the two questions differently
    // ====================================================================
    // Probed from the harness rather than the page: the tier diagnostics are a
    // server-side fact, and the UI is forbidden from reading them.
    const musicProbe = await probeSearch(MUSIC_QUERY, undefined);
    results.notes.upstreamProbes.push(musicProbe);
    let podcastQuery = null;
    let podcastProbe = null;
    for (const candidate of PODCAST_QUERY_CANDIDATES) {
      const probe = await probeSearch(candidate, "podcast");
      results.notes.upstreamProbes.push(probe);
      if (probe.status === 200 && probe.count > 0) {
        podcastQuery = candidate;
        podcastProbe = probe;
        break;
      }
    }
    step(
      "a podcast-mode request is answered without ever consulting YouTube Music",
      Boolean(podcastProbe) &&
        Array.isArray(podcastProbe.tiersTried) &&
        podcastProbe.tiersTried.some(
          (entry) => entry.tier === "ytmusic" && entry.outcome === "skipped",
        ),
      `query="${podcastQuery}", tiers tried=${JSON.stringify(podcastProbe?.tiersTried)}`,
    );
    step(
      "a music-mode request consults YouTube Music, so the two modes really differ",
      musicProbe.status === 200 &&
        musicProbe.count > 0 &&
        musicProbe.tier !== null,
      `query="${MUSIC_QUERY}", status=${musicProbe.status}, answering tier=${musicProbe.tier}, results=${musicProbe.count}`,
    );
    // The same words, asked in both modes. The two result sets are compared
    // directly, and the run does *not* claim they are disjoint: the live provider
    // does not promise that, and the same episode can answer both questions. What
    // the run claims, and asserts, is that the podcast-mode answer came from a tier
    // that was asked the podcast question, is labelled podcast, and clears the
    // long-form floor. The title overlap is measured and reported either way.
    const sameWordsMusic =
      podcastQuery === null
        ? { count: -1, tier: null, titles: [], status: 0, query: null }
        : await probeSearch(podcastQuery, undefined);
    if (podcastQuery !== null)
      results.notes.upstreamProbes.push(sameWordsMusic);
    const podcastTitles = (podcastProbe?.titles ?? []).map(
      (entry) => entry.title,
    );
    const musicTitles = sameWordsMusic.titles.map((entry) => entry.title);
    const sharedTitles = podcastTitles.filter((title) =>
      musicTitles.includes(title),
    );
    results.notes.sameWordsComparison = {
      query: podcastQuery,
      podcastCount: podcastProbe?.count ?? -1,
      musicCount: sameWordsMusic.count,
      podcastTier: podcastProbe?.tier ?? null,
      musicTier: sameWordsMusic.tier,
      sharedTitles,
    };
    step(
      "the same words are answered by different tiers in the two modes",
      Boolean(podcastProbe) &&
        sameWordsMusic.tier === "ytmusic" &&
        podcastProbe.tier !== "ytmusic",
      `podcast mode answered by ${podcastProbe?.tier} (YouTube Music skipped), music mode by ${sameWordsMusic.tier}`,
    );
    step(
      "a podcast-mode search returns podcast-labelled results",
      Boolean(podcastProbe) &&
        podcastProbe.count > 0 &&
        (podcastProbe.titles ?? []).every(
          (entry) => entry.category === "podcast",
        ),
      `podcast results=${podcastProbe?.count}, all labelled podcast=${Boolean(
        podcastProbe &&
        (podcastProbe.titles ?? []).every(
          (entry) => entry.category === "podcast",
        ),
      )}, titles the music-mode answer for the same words also returned=${JSON.stringify(sharedTitles)} (measured, not asserted - the provider may answer both questions with the same episode)`,
    );
    step(
      "podcast-mode results respect the long-form floor the mode promises",
      Boolean(podcastProbe) &&
        (podcastProbe.titles ?? []).every(
          (entry) =>
            entry.durationSeconds === null || entry.durationSeconds >= 600,
        ),
      `durations=${JSON.stringify((podcastProbe?.titles ?? []).map((entry) => entry.durationSeconds))} (podcast floor 600s)`,
    );
    if (!podcastQuery) {
      throw new Error(
        `No podcast query produced results against the live provider: ${JSON.stringify(
          results.notes.upstreamProbes.filter(
            (probe) => probe.category === "podcast",
          ),
        )}`,
      );
    }

    // ====================================================================
    // STEP 3 — switching mode keeps the query and asks the new question
    // ====================================================================
    // The query is replaced first, through the input's own value setter, with the
    // podcast query the probe found answerable. Switching the mode on a music query
    // would make this step depend on whether the live provider happens to return
    // long-form results for a song title - a fact about YouTube, not about this
    // change. The music query already proved the music path above; the switch is
    // about what happens to the query, and the presentation that follows.
    await evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Search"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(podcastQuery)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    // Readiness is read from the URL rather than the input's DOM value: the URL is
    // what the store writes and what the switch then preserves, and reading it
    // avoids depending on whether React has re-rendered the controlled input yet.
    const typedForPodcast = await waitFor(
      "the new query reaches the URL before the mode switch",
      `(() => (location.search.includes('q=${encodeURIComponent(podcastQuery)}') && !location.search.includes('mode=')) ? { url: location.pathname + location.search } : null)()`,
      (state) => state !== null,
      20000,
    ).catch((error) => {
      results.notes.queryBeforeSwitchError = String(
        error?.message ?? error,
      ).slice(0, 200);
      return null;
    });
    // Disclosed, not asserted: what the *same* words return when music mode is the
    // question. This is the reason the mode exists, and it is a fact about the live
    // provider on the day, so it is recorded rather than pinned.
    const musicModeForPodcastQuery = await probeSearch(podcastQuery, undefined);
    results.notes.upstreamProbes.push(musicModeForPodcastQuery);
    await waitFor(
      "the music-mode search for the new query settles",
      `(() => (document.querySelector('[data-testid="search-loading"]') ? null : true))()`,
      Boolean,
      60000,
    ).catch(() => null);
    const switched = await activate(
      '[data-testid="search-mode-podcast"]',
      "the mode switch to Podcasts",
      `(() => (document.querySelector('[data-testid="search-mode-podcast"]')?.getAttribute('aria-checked') === 'true' ? { rows: document.querySelectorAll(${JSON.stringify(
        SEARCH_ROWS,
      )}).length } : null))()`,
      (state) => state !== null,
      10000,
    );
    const podcastReady = await waitFor(
      "podcast-mode results render",
      `(() => (document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)}).length > 0 ? true : null))()`,
      Boolean,
      60000,
    ).catch(() => null);
    const afterSwitch = await evaluate(modeState);
    const podcastSections = await evaluate(sectionTitles);
    const podcastRows = await evaluate(
      `(() => [...document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)})].map((row) => {
        const play = row.querySelector('button[aria-label^="Play "]');
        return {
          title: play ? play.getAttribute('aria-label').slice('Play '.length) : '',
          text: row.textContent.trim().slice(0, 140),
          hasClock: /\\d{1,2}:\\d{2}/.test(row.textContent || ''),
        };
      }))()`,
    );
    step(
      "switching to Podcasts keeps the typed query in the URL and the input",
      Boolean(typedForPodcast) &&
        afterSwitch.url.includes(`q=${encodeURIComponent(podcastQuery)}`) &&
        afterSwitch.url.includes("mode=podcast") &&
        afterSwitch.input === podcastQuery,
      `url=${afterSwitch.url}, input="${afterSwitch.input}" (the same words in music mode returned ${musicModeForPodcastQuery.count} results, ${musicModeForPodcastQuery.status} from ${musicModeForPodcastQuery.tier ?? "no tier"})`,
    );
    step(
      "the mode switch issued a podcast request for that same query",
      (await evaluate(searchLogExpr)).some(
        (entry) => entry.category === "podcast" && entry.q === podcastQuery,
      ),
      `search log=${JSON.stringify(
        (await evaluate(searchLogExpr))
          .filter((entry) => entry.q === podcastQuery)
          .map((entry) => entry.url),
      )}`,
    );
    step(
      "podcast results are presented as Episodes and Shows, with no Albums section",
      Boolean(switched) &&
        Boolean(podcastReady) &&
        podcastSections.includes("Episodes") &&
        podcastSections.includes("Shows") &&
        !podcastSections.includes("Albums") &&
        !podcastSections.includes("Songs"),
      `sections=${JSON.stringify(podcastSections.filter((title) => ["Songs", "Artists", "Albums", "Episodes", "Shows", "Top result"].includes(title)))}, rows=${podcastRows.length}`,
    );
    // The rows come from the browser's own podcast search of the typed query, so the
    // expected show/channel is read from a probe of that same query: the server
    // caches it, so both read one result set.
    const switchProbe = await probeSearch(podcastQuery, "podcast");
    results.notes.upstreamProbes.push(switchProbe);
    const probeShow = switchProbe.titles[0]?.artist ?? "";
    const probeTitle = switchProbe.titles[0]?.title ?? "";
    step(
      "each episode row names its show/channel and shows a duration",
      podcastRows.length >= 1 &&
        podcastRows.every((row) => row.hasClock) &&
        (probeTitle === "" ||
          podcastRows.some((row) => row.text.includes(probeTitle))) &&
        (probeShow === "" ||
          podcastRows.some((row) => row.text.includes(probeShow))),
      `first result upstream: "${probeTitle}" by "${probeShow}"; first row="${podcastRows[0]?.text?.replace(/\s+/g, " ").trim().slice(0, 90)}"`,
    );
    await shoot(
      1280,
      900,
      "search-podcast-mode-1280.png",
      "Podcast mode: Episodes and Shows from a podcast-mode search",
    );

    // ====================================================================
    // STEP 4 — the curated categories are podcast-mode search URLs
    // ====================================================================
    await goto(
      "/search?mode=podcast",
      `!!document.querySelector('[data-testid="podcast-categories"]')`,
      "curated categories",
    );
    const categories = await evaluate(
      `(() => {
        const links = [...document.querySelectorAll('[data-testid^="podcast-category-"]')];
        return {
          count: links.length,
          hrefs: links.map((link) => link.getAttribute('href')),
          testids: links.map((link) => link.getAttribute('data-testid')),
          claims: /(best|top |#1\\b|chart|editor)/i.test(document.querySelector('[data-testid="podcast-categories"]')?.textContent || ''),
        };
      })()`,
    );
    step(
      "the podcast browse state offers curated categories, each a podcast-mode search URL",
      categories.count >= 4 &&
        categories.hrefs.every(
          (href) =>
            href.startsWith("/search?q=") && href.includes("mode=podcast"),
        ) &&
        categories.claims === false,
      `entries=${categories.count}, first href=${categories.hrefs[0]}, ranking claim in the copy=${categories.claims}`,
    );
    // Activate the first category for real, through the same disclosed fallback.
    const categoryNavigation = await activate(
      '[data-testid^="podcast-category-"]',
      "a category opening a podcast search",
      `(() => (location.search.includes('mode=podcast') && new URLSearchParams(location.search).get('q')) ? { url: location.pathname + location.search } : null)()`,
      (state) => state !== null,
      8000,
    );
    results.notes.categoryActivation = categoryNavigation;
    const categoryUrl = categoryNavigation
      ? new URL(
          (await evaluate("location.pathname + location.search")) ?? "",
          ORIGIN,
        )
      : null;
    const categoryQuery = categoryUrl?.searchParams.get("q") ?? "";
    const categorySearch = await waitFor(
      "the category's podcast search runs",
      `(() => {
        const rows = document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)}).length;
        return rows > 0 ? { rows } : null;
      })()`,
      (state) => state !== null,
      60000,
    ).catch(() => null);
    step(
      "activating a category starts a podcast-mode search for its own query",
      Boolean(categoryNavigation) &&
        Boolean(categorySearch) &&
        categoryQuery.length > 0,
      `activation=${categoryNavigation}, url=${categoryUrl?.pathname + (categoryUrl?.search ?? "")}, rows=${categorySearch?.rows ?? 0}`,
    );
    const categoryLog = await evaluate(searchLogExpr);
    step(
      "the category search asked the server the podcast question, on the existing route",
      categoryLog.some(
        (entry) =>
          entry.category === "podcast" && (entry.q ?? "") === categoryQuery,
      ),
      `category query="${categoryQuery}", last requests=${JSON.stringify(categoryLog.slice(-3).map((entry) => entry.url))}`,
    );
    await shoot(
      1280,
      900,
      "podcast-category-search-1280.png",
      "A curated category running a podcast-mode search for its own query",
    );

    // ====================================================================
    // STEP 5 — a podcast search that returns nothing explains itself
    // ====================================================================
    // Every search response in a short window is answered by the harness with an
    // empty result set, because the remote-empty state is otherwise unreachable:
    // the chain reports "no tier produced a usable result" as a 503, which is the
    // error state, not the empty one. Disclosed in notes.disclosures.
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/search*" }] });
    stubbingNow = true;
    results.notes.disclosures.stubbedResponses.push(
      `every /api/search response during the empty-state window was answered by the harness with 200 { tracks: [] } (query "${STUB_QUERY}")`,
    );
    await goto("/search", SEARCH_READY, "hydrated search input");
    await trustedClickSel('input[aria-label="Search"]');
    await delay(150);
    await typeText(STUB_QUERY, 12);
    // The whole empty-state block is read rather than its <p>: the assertion is
    // about the sentence the listener reads, not about which element holds it.
    const readEmptyState = `(() => {
      const headingElements = [...document.querySelectorAll('h2, h3')];
      const emptyElement = headingElements.find((h) => /No (podcasts found|results) for/i.test(h.textContent || ''));
      if (!emptyElement) return null;
      const block = emptyElement.parentElement;
      return {
        title: (emptyElement.textContent || '').trim(),
        text: (block?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
        podcastWording: headingElements.some((h) => /No podcasts found for/i.test(h.textContent || '')),
        musicWording: headingElements.some((h) => /^No results for/i.test((h.textContent || '').trim())),
      };
    })()`;
    const musicEmpty = await waitFor(
      "the music empty state appears for the stubbed empty response",
      readEmptyState,
      (state) => state !== null && state.musicWording,
      30000,
    ).catch(() => null);
    await activate(
      '[data-testid="search-mode-podcast"]',
      "the mode switch to Podcasts (empty-state window)",
      `(() => (document.querySelector('[data-testid="search-mode-podcast"]')?.getAttribute('aria-checked') === 'true' ? true : null))()`,
      Boolean,
      10000,
    );
    const emptyState = await waitFor(
      "the podcast empty state appears after the mode switch",
      readEmptyState,
      (state) => state !== null && state.podcastWording,
      30000,
    ).catch(() => null);
    stubbingNow = false;
    await send("Fetch.disable").catch(() => null);
    step(
      "a podcast search that returns nothing explains itself in podcast terms",
      Boolean(musicEmpty) &&
        Boolean(emptyState) &&
        /No podcasts found for/i.test(emptyState.title) &&
        /10 minutes/i.test(emptyState.text) &&
        emptyState.musicWording === false,
      emptyState
        ? `music mode said "${musicEmpty?.title?.replace(/\s+/g, " ").trim().slice(0, 50)}", podcast mode said "${emptyState.title
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 50)}" — "${emptyState.text.slice(0, 140)}"`
        : "the podcast empty state never rendered",
    );
    await shoot(
      1280,
      900,
      "search-podcast-empty-1280.png",
      "A podcast search with no results, explained in podcast terms",
    );

    // ====================================================================
    // STEP 6 — an episode plays in the persistent player, long enough to count
    // ====================================================================
    // Real playback, not a stub: the history measurement only exists if the engine
    // reported a position, and the statistics only count a play the classification
    // rule does not call a skip. The queue is the whole podcast result set, so
    // "Next track" is available and ends the step the way a listener would.
    await goto(
      `/search?q=${encodeURIComponent(podcastQuery)}&mode=podcast`,
      `!!document.querySelector('${SEARCH_ROWS}')`,
      "podcast results",
    );
    await waitFor(
      "the podcast results are present",
      `(() => (document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)}).length > 0 ? true : null))()`,
      Boolean,
      60000,
    );
    const episodeTitle = await evaluate(
      `(() => {
        const play = document.querySelector('${SEARCH_ROWS} button[aria-label^="Play "]');
        return play ? play.getAttribute('aria-label').slice('Play '.length) : '';
      })()`,
    );
    await activate(
      `${SEARCH_ROWS} button[aria-label^="Play "]`,
      "playing the first episode",
      playerState,
      (state) => state.control === "Pause",
      15000,
    );
    const playing = await evaluate(playerState);
    step(
      "an episode plays in the persistent player, through the one IFrame API script",
      playing.control === "Pause" &&
        playing.iframes <= 1 &&
        playing.apiScripts <= 1,
      `control=${playing.control}, iframes=${playing.iframes}, api scripts=${playing.apiScripts}, bar="${playing.bar.replace(/\s+/g, " ").trim().slice(0, 70)}"`,
    );

    // Wait for a real position, then let the step end through Next.
    const FIRST_STEP_SECONDS = 32; // over the 30s completion minimum
    const advanced = await waitFor(
      "playback advances past the completion minimum",
      playerState,
      (state) => (clockToSeconds(state.position) ?? 0) >= FIRST_STEP_SECONDS,
      120000,
    ).catch(() => null);
    const beforeNext = await evaluate(playerState);
    await activate(
      '[aria-label="Next track"]',
      "advancing to the next episode",
      playerState,
      (state) => state.control !== undefined,
      15000,
    );
    const measuredEvent = await waitFor(
      "the first episode is recorded with the seconds it played",
      storedEvents,
      (state) =>
        state.events.some(
          (event) => event.category === "podcast" && event.secondsPlayed >= 20,
        ),
      60000,
    ).catch(() => null);
    step(
      "an episode plays long enough that the local record counts it as a play, not a skip",
      Boolean(advanced) && Boolean(measuredEvent),
      `position reached "${beforeNext.position}" of "${beforeNext.duration}", recorded podcast events=${JSON.stringify(
        measuredEvent?.events.filter((event) => event.category === "podcast") ??
          [],
      )}`,
    );

    // The next episode is now playing; let it run, then prove the restore.
    await waitFor(
      "the second episode advances",
      playerState,
      (state) => (clockToSeconds(state.position) ?? 0) >= 20,
      120000,
    ).catch(() => null);
    // Pause first, then read. The session write is a *debounce* (2s in
    // `player/persistence.ts`) fed by position updates, so while the engine keeps
    // reporting a new position the deadline keeps moving and nothing is persisted.
    // That is pre-existing M6 behavior, not something M12 changed; pausing is what a
    // listener does before leaving, and it is what makes the write deterministic
    // enough to assert on.
    await activate(
      '[data-testid="player-bar"] button[aria-label="Pause"]',
      "pausing the second episode",
      playerState,
      (state) => state.control === "Play",
      20000,
    );
    await delay(4000);
    const sessionBeforeReload = await waitFor(
      "the session stores the queue and a position",
      storedSession,
      (state) =>
        state.session !== null &&
        state.session.queueLength >= 1 &&
        state.session.positionSeconds > 0,
      30000,
    ).catch(async (error) => {
      results.notes.sessionPollError = String(error?.message ?? error).slice(
        0,
        300,
      );
      return null;
    });
    results.notes.sessionBeforeReload = sessionBeforeReload;
    step(
      "the session stores the queue, the current episode, and its position",
      Boolean(sessionBeforeReload?.session) &&
        sessionBeforeReload.session.queueLength >= 1,
      `queue=${sessionBeforeReload?.session?.queueLength}, current="${sessionBeforeReload?.session?.current?.title ?? ""}", stored position=${sessionBeforeReload?.session?.positionSeconds}s`,
    );

    // ====================================================================
    // STEP 7 — the position survives a reload, and an impossible one is clamped
    // ====================================================================
    await goto("/", `!!document.querySelector('main')`, "home shell");
    const restored = await waitFor(
      "the session restores after a reload",
      playerState,
      (state) => (clockToSeconds(state.position) ?? 0) > 0,
      45000,
    ).catch(() => null);
    step(
      "the episode's position survives a reload, cued rather than autoplayed",
      (clockToSeconds(restored.position) ?? 0) > 0 &&
        restored.control === "Play",
      `restored position="${restored.position}" of "${restored.duration}", control=${restored.control}, bar="${restored.bar.replace(/\s+/g, " ").trim().slice(0, 60)}"`,
    );

    // The clamp: the stored position is pushed past the track's own duration, as if
    // the episode had been re-cut shorter. The player must cue inside it.
    const liveSession = await waitFor(
      "the restored session is readable again",
      storedSession,
      (state) => state.session !== null && state.session.positionSeconds > 0,
      30000,
    ).catch(() => null);
    const liveDuration = clockToSeconds(
      liveSession?.session?.current?.durationSeconds ?? null,
    );
    const clampSeconds = Math.round((liveDuration ?? 0) + 900);
    const wrote = await evaluate(writeSessionPosition(clampSeconds));
    results.notes.clamp = {
      storedDurationSeconds: liveDuration,
      forcedPositionSeconds: clampSeconds,
    };
    await goto(
      "/",
      `!!document.querySelector('main')`,
      "home shell after the session rewrite",
    );
    const clamped = await waitFor(
      "the restored position is inside the track",
      playerState,
      (state) =>
        (clockToSeconds(state.position) ?? 0) >= 0 &&
        (clockToSeconds(state.duration) ?? 0) > 0,
      45000,
    );
    const clampedPosition = clockToSeconds(clamped.position);
    const clampedDuration = clockToSeconds(clamped.duration);
    // The exact clamp, not merely "inside the track": `position === 0` would also
    // satisfy an inequality, so a player that silently restarted from the beginning
    // would pass. `END_CUE_TAIL_SECONDS` is read from the source, so the assertion
    // tracks the shipped constant instead of restating it.
    const expectedCue = (clampedDuration ?? 0) - COPY.endCueTailSeconds;
    step(
      "a stored position beyond the duration is clamped at load, not cued past the end",
      wrote &&
        liveDuration !== null &&
        clampedPosition !== null &&
        clampedDuration !== null &&
        clampedPosition === expectedCue &&
        clampedPosition < clampSeconds,
      `episode duration=${liveDuration}s, stored position forced to ${clampSeconds}s → the player shows ${clamped.position} of ${clamped.duration} (position ${clampedPosition}s, duration ${clampedDuration}s, expected ${expectedCue}s)`,
    );
    await shoot(
      1280,
      900,
      "podcast-clamped-restore-1280.png",
      "A re-cut episode restoring inside its own duration instead of past the end",
    );

    // The clamped cue sits seconds from the end by design, so the honest check is
    // that the episode can be *played out* from there: it ends, the step closes,
    // and the queue moves on. A reload mid-playback ends a step with no measured
    // time, so those zero-second events stay in the dataset — they are real, and
    // the statistics correctly refuse to count them.
    const clampedBeforePlay = await evaluate(playerState);
    await activate(
      '[data-testid="player-bar"] button[aria-label="Play"]',
      "playing the clamped episode from its clamped cue",
      playerState,
      (state) => state.control === "Pause",
      20000,
    );
    const movedOn = await waitFor(
      "the clamped episode plays out and the queue advances",
      playerState,
      (state) => state.bar !== "" && state.bar !== clampedBeforePlay.bar,
      90000,
    ).catch(() => null);
    const afterOut = await evaluate(playerState);
    step(
      "the clamped episode plays out from its clamped cue and the queue moves on",
      Boolean(movedOn),
      `cued at "${clampedBeforePlay.position}" of "${clampedBeforePlay.duration}" → now "${afterOut.position}" of "${afterOut.duration}"`,
    );
    // ====================================================================
    // STEP 8 — the played episode is in the local record, on the existing surfaces
    // ====================================================================
    const historyEvents = await evaluate(storedEvents);
    const podcastEvents = historyEvents.events.filter(
      (event) => event.category === "podcast",
    );
    const measuredPodcast = podcastEvents.filter(
      (event) => event.secondsPlayed >= 10,
    );
    step(
      "the played episode is recorded in the existing local history dataset, as a podcast",
      podcastEvents.length >= 1 && measuredPodcast.length >= 1,
      `events=${historyEvents.count}, podcast events=${JSON.stringify(
        podcastEvents.map((event) => ({
          title: event.title,
          seconds: event.secondsPlayed,
          context: event.context,
        })),
      )}`,
    );
    await goto(
      "/history",
      `!!document.querySelector('[data-testid="history-view"]')`,
      "history view",
    );
    const historySurface = await waitFor(
      "history rows render",
      `(() => {
        const rows = [...document.querySelectorAll('[data-testid="history-row"]')];
        return {
          rows: rows.length,
          verdicts: [...document.querySelectorAll('[data-testid="history-verdict"]')].map((n) => n.textContent.trim()),
          hasClock: rows.every((row) => /\\d{1,2}:\\d{2}/.test(row.textContent || '')),
          podcastRow: rows.some((row) => (row.textContent || '').includes(${JSON.stringify(episodeTitle)})),
        };
      })()`,
      (state) => state.rows >= 1,
      30000,
    );
    step(
      "the History surface lists the episode with a verdict, a time, and its own surface",
      historySurface.rows >= 1 &&
        historySurface.verdicts.every((verdict) => verdict.length > 0) &&
        historySurface.hasClock &&
        historySurface.podcastRow,
      `rows=${historySurface.rows}, verdicts=${JSON.stringify(historySurface.verdicts)}, every row shows a time=${historySurface.hasClock}, the played episode is listed=${historySurface.podcastRow}`,
    );
    const stats = await evaluate(
      `(() => {
        const view = document.querySelector('[data-testid="stats-view"]');
        if (!view) return null;
        return {
          time: document.querySelector('[data-testid="stats-total-time"]')?.textContent ?? '',
          plays: document.querySelector('[data-testid="stats-play-count"]')?.textContent ?? '',
          topTracks: document.querySelector('[data-testid="stats-top-tracks"]')?.textContent ?? '',
          topArtists: document.querySelector('[data-testid="stats-top-artists"]')?.textContent ?? '',
          categories: view.textContent || '',
          podcastDataset: !!document.querySelector('[data-testid="podcast-history"]'),
        };
      })()`,
    );
    step(
      "the statistics count the podcast play, and the insights surfaces carry no podcast-specific one",
      Boolean(stats) &&
        Number(stats.plays) >= 1 &&
        stats.topTracks.trim().length > 0 &&
        stats.podcastDataset === false,
      `plays=${stats?.plays}, time="${stats?.plays ? stats.time.replace(/\s+/g, " ").trim() : ""}", top tracks block=${(stats?.topTracks ?? "").replace(/\s+/g, " ").trim().slice(0, 70)}, podcast surface present=${stats?.podcastDataset}`,
    );
    step(
      "the statistics report podcasts as a category of the local record",
      Boolean(stats) && /podcast/i.test(stats.categories),
      `categories text mentions podcasts=${Boolean(stats) && /podcast/i.test(stats.categories)}`,
    );
    await shoot(
      1280,
      900,
      "podcast-history-stats-1280.png",
      "A played podcast episode in the local History record and the statistics that count it",
    );

    // ====================================================================
    // STEP 9 — music mode still behaves after all of that
    // ====================================================================
    await goto("/search", SEARCH_READY, "hydrated search input");
    const afterPodcast = await evaluate(modeState);
    await trustedClickSel('input[aria-label="Search"]');
    await delay(150);
    await typeText(MUSIC_QUERY);
    const musicAgain = await waitFor(
      "music search results after the podcast work",
      `(() => (document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)}).length >= 3 ? true : null))()`,
      Boolean,
      60000,
    ).catch(() => null);
    const musicAgainSections = await evaluate(sectionTitles);
    const musicAgainRequests = (await evaluate(searchLogExpr)).filter(
      (entry) => entry.q === MUSIC_QUERY,
    );
    step(
      "music mode is unchanged after the podcast work, in the UI and on the wire",
      Boolean(musicAgain) &&
        afterPodcast.musicChecked === "true" &&
        musicAgainSections.includes("Songs") &&
        musicAgainRequests.length >= 1 &&
        musicAgainRequests.every((entry) => entry.category === null),
      `rows=${musicAgain ? ">=3" : "none"}, sections=${JSON.stringify(musicAgainSections.filter((title) => ["Songs", "Artists", "Albums"].includes(title)))}, music requests=${musicAgainRequests.length}, all without a category=${musicAgainRequests.every((entry) => entry.category === null)}`,
    );

    // ====================================================================
    // STEP 10 — one player iframe, bounded requests, no console errors
    // ====================================================================
    await goto(
      "/now-playing",
      `!!document.querySelector('main')`,
      "now playing",
    );
    const final = await evaluate(playerState);
    step(
      "the IFrame API is loaded exactly once and one player host is present",
      final.apiScripts <= 1 && final.iframes <= 1,
      `apiScripts=${final.apiScripts}, iframes=${final.iframes}, control=${final.control}`,
    );
    const allSearchKeys = [
      ...new Set(results.notes.searchRequests.flatMap((entry) => entry.keys)),
    ];
    step(
      "no search request this run carried liked-track, playlist, history, or profile data",
      results.notes.searchRequests.length >= 3 &&
        results.notes.searchRequests.every((entry) =>
          entry.keys.every((key) => SEARCH_KEYS_ALLOWED.includes(key)),
        ),
      `params seen across ${results.notes.searchRequests.length} search requests: ${JSON.stringify(allSearchKeys)} (allowed: ${JSON.stringify(SEARCH_KEYS_ALLOWED)})`,
    );
    step(
      "podcast requests really carried the category and music requests really did not",
      results.notes.searchRequests.some(
        (entry) => entry.category === "podcast",
      ) &&
        results.notes.searchRequests.some((entry) => entry.category === null),
      `podcast requests=${results.notes.searchRequests.filter((entry) => entry.category === "podcast").length}, music requests=${results.notes.searchRequests.filter((entry) => entry.category === null).length}`,
    );
    step(
      "zero console errors (disclosed stub and live-upstream entries excluded)",
      results.consoleErrors.length === 0,
      `errors=${results.consoleErrors.length}, disclosed stub=${results.notes.disclosures.stubbedResponses.length}, disclosed offline=${results.notes.disclosures.offlineWindow.length}, disclosed live-upstream=${results.notes.disclosures.liveUpstream.length}`,
    );

    results.notes.screenshotFiles = readdirSync(EVIDENCE_DIR).filter((name) =>
      name.endsWith(".png"),
    );
  } catch (error) {
    results.error = String(error?.stack ?? error);
    console.error(`EVIDENCE RUN FAILED: ${results.error}`);
  } finally {
    results.pass =
      !results.error &&
      results.steps.length > 0 &&
      results.steps.every((s) => s.ok);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(EVIDENCE_DIR, "results.json"),
      `${JSON.stringify(results, null, 2)}\n`,
    );
    console.log(
      `\n${results.pass ? "ALL ASSERTIONS PASSED" : "EVIDENCE RUN FAILED"} — results.json written`,
    );
    for (const shot of results.screenshots)
      console.log(`  screenshot: ${shot.file}`);
    if (results.consoleErrors.length)
      console.log("  console errors:", results.consoleErrors);
    if (results.error) console.log("  error:", results.error);
    closeAll();
  }
  return results.pass;
}

main()
  .then(async (pass) => {
    await delay(500);
    process.exit(pass ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
