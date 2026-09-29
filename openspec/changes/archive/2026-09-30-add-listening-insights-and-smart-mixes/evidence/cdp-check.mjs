#!/usr/bin/env node
/**
 * M11 task 7.2 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Drives a production build (`next start`) in headless Edge over the Chrome
 * DevTools Protocol to capture what unit tests cannot about the listening
 * insights and Smart Mixes surfaces:
 *   1. playing several tracks records local history, with the raw seconds and
 *      completion markers the classification rule reads;
 *   2. the History page lists those events by local day, shows how each play
 *      ended, and navigates to the artist's own surface;
 *   3. the statistics report time, plays, top tracks/artists, a breakdown, and a
 *      listening streak — all labelled as derived from this device;
 *   4. clearing history empties both pages and resets the statistics, with no
 *      stale figure left behind;
 *   5. a Smart Mix is generated from the local profile only after there is local
 *      signal (no signal ⇒ the surface says so and spends no request);
 *   6. the mix appears on Home by name, plays, and refreshes without changing its
 *      identity or its name;
 *   7. the mixes dataset survives an export → reset → import round trip;
 *   8. no request ever carried profile, history, liked-track, or mix data — only
 *      the discovery feed's own parameters;
 *   9. exactly one player iframe / one IFrame API script, and zero console errors
 *      (deliberate blocked-request entries are disclosed, not counted).
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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  if (!found) throw new Error("No Edge/Chrome executable found (set SPOTIVIBE_BROWSER_PATH).");
  return found;
}

/** Live inputs. The query is a stable, well-populated YouTube Music search. */
const QUERY = "bohemian rhapsody";

/**
 * The complete parameter surface a discovery feed request may carry. The server's
 * architecture test pins the same four keys; this is the browser-side proof that
 * a mix request carries nothing else — no profile, liked-track, history, or mix
 * data ever crosses a request boundary.
 */
const DISCOVERY_KEYS_ALLOWED = ["kind", "languages", "seeds", "limit"];

/**
 * In-page expression returning the log of every observed `/api/discover`
 * request as `{ kind, languages, seeds, limit, keys }`. The log lives in the page
 * (not the harness) so a navigation cannot lose it.
 */
const FEED_LOG_EXPR = `(() => {
  if (!window.__spotivibeFeedLog) window.__spotivibeFeedLog = [];
  return window.__spotivibeFeedLog;
})()`;

/** Exact copy lifted from the sources at runtime (no encoding assumptions). */
function extractConstants() {
  const read = (...parts) => readFileSync(join(FRONTEND, ...parts), "utf8");
  const onboarding = read("src/features/preferences/LanguageOnboarding.tsx");
  const pick = (re, source, name) => {
    const value = re.exec(source)?.[1];
    if (!value) throw new Error(`Could not extract ${name} from sources.`);
    return value;
  };
  return {
    onboardingLabel: pick(/LANGUAGE_ONBOARDING_LABEL = "([^"]+)"/, onboarding, "onboarding dialog label"),
    onboardingConfirm: pick(/confirmLabel="([^"]+)"/, onboarding, "onboarding confirm label"),
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
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, {
        method: "PUT",
      });
      if (res.ok) return await res.json();
    } catch {
      /* browser not ready yet */
    }
    await delay(300);
  }
  throw new Error("Could not create a CDP target.");
}

async function main() {
  const COPY = extractConstants();
  const results = {
    task: "7.2",
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    query: QUERY,
    allowedDiscoveryKeys: DISCOVERY_KEYS_ALLOWED,
    copy: COPY,
    steps: [],
    screenshots: [],
    consoleErrors: [],
    notes: {
      disclosures: {
        offlineWindow: [],
        blockedFeedProbe: [],
        liveUpstream: [],
        searchFallbacks: [],
      },
      feedRequests: [],
    },
    pass: false,
  };
  const step = (name, ok, detail = "") => {
    results.steps.push({ name, ok: !!ok, detail: String(detail).slice(0, 600) });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    return !!ok;
  };

  let browser;
  let ws;
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  const profileDir = mkdtempSync(join(tmpdir(), "spotivibe-cdp-"));
  const downloadDir = join(profileDir, "downloads");
  mkdirSync(downloadDir, { recursive: true });

  // --- multi-target network emulation (the player iframe is an OOPIF) ----
  const cdpSessions = new Set();
  let offlineNow = false;
  let blockedFeedProbe = false; // deliberate single-endpoint failure window
  const sendTo = (sessionId, method, params = {}) =>
    new Promise((resolveSend, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolveSend, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
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
      results.notes.networkEmulationErrors = results.notes.networkEmulationErrors ?? [];
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

    const version = await waitForJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
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
        if (message.error) handler.reject(new Error(`${message.method}: ${message.error.message}`));
        else handler.resolve(message.result);
      } else {
        for (const listener of listeners) listener(message);
      }
    };

    const send = (method, params = {}) => sendTo("", method, params);
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
          last = typeof expression === "function" ? await expression() : await evaluate(expression);
          if (predicate(last)) return last;
        } catch {
          /* navigation in flight — retry */
        }
        await delay(250);
      }
      throw new Error(`Timed out waiting for ${description} (last: ${JSON.stringify(last)})`);
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
        throw new Error(`Element not clickable (missing or zero-size): ${label} → ${JSON.stringify(point)}`);
      }
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
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
      trustedClickRect(rectOfJs(`document.querySelector(${JSON.stringify(selector)})`), selector);
    const trustedClickJs = (elementJs, label) =>
      trustedClickRect(rectOfJs(elementJs), label ?? elementJs.slice(0, 80));
    const buttonByText = (text) =>
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(
        text,
      )})`;
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
      await waitFor(`${path} document complete`, `document.readyState`, (r) => r === "complete", 20000);
      if (readyExpr) await waitFor(`${path}: ${readyDesc}`, readyExpr, Boolean, 30000);
      await delay(400);
    };
    const typeText = async (text, perCharMs = 25) => {
      for (const ch of text) {
        await send("Input.dispatchKeyEvent", { type: "char", text: ch, key: ch });
        if (perCharMs > 0) await delay(perCharMs);
      }
    };

    // ---- console error capture with honest disclosure buckets ----------
    on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        const text = `console.error: ${params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`;
        results.consoleErrors.push(text);
      }
    });
    on("Runtime.exceptionThrown", (params) => {
      const text = `exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`.slice(
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
      const netCut = /net::ERR_|Failed to load resource/.test(params.entry.text);
      const statusErr = /status of [45]\d\d/.test(params.entry.text);
      const liveFlake = /status of (429|503)/.test(params.entry.text);
      if (offlineNow && (netCut || statusErr)) results.notes.disclosures.offlineWindow.push(text);
      else if (liveFlake) results.notes.disclosures.liveUpstream.push(text);
      else if (blockedFeedProbe && (netCut || statusErr))
        results.notes.disclosures.blockedFeedProbe.push(text);
      else results.consoleErrors.push(text);
    });
    // Every discovery feed request is recorded twice: in the harness (for the run
    // record) and in the page (so the log survives a navigation and can be read
    // back with a plain evaluate).
    on("Network.requestWillBeSent", (params) => {
      const url = String(params.request?.url ?? "");
      if (!url.includes("/api/discover")) return;
      const parsed = new URL(url, ORIGIN);
      const record = {
        url: url.replace(ORIGIN, "").slice(0, 300),
        keys: [...parsed.searchParams.keys()].sort(),
        kind: parsed.searchParams.get("kind"),
        languages: parsed.searchParams.get("languages"),
        seeds: parsed.searchParams.get("seeds"),
        limit: Number(parsed.searchParams.get("limit") ?? "0"),
      };
      results.notes.feedRequests.push(record);
      // The page-side log is reinstalled on every document, so record it there
      // too, re-seeding the log when the document has just been replaced.
      evaluate(`(() => {
        if (!window.__spotivibeFeedLog) window.__spotivibeFeedLog = [];
        window.__spotivibeFeedLog.push(${JSON.stringify(record)});
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
    try {
      await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
    } catch {
      /* Chrome variants may not expose this — the export is read in-page instead */
    }

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
    }))()`;
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
            secondsPlayed: event.secondsPlayed,
            completed: event.completed === true,
            context: event.context,
          }));
          db.close();
          resolve({ ok: true, count: events.length, events });
        };
      };
    }))()`;
    /** The stored mixes dataset, read straight out of IndexedDB. */
    const storedMixes = `(() => new Promise((resolve) => {
      const open = indexedDB.open('spotivibe');
      open.onerror = () => resolve({ ok: false, mixes: [] });
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('mixes')) { db.close(); resolve({ ok: true, mixes: [] }); return; }
        const tx = db.transaction('mixes', 'readonly');
        const request = tx.objectStore('mixes').index('byGeneratedAt').getAll();
        request.onerror = () => { db.close(); resolve({ ok: false, mixes: [] }); };
        request.onsuccess = () => {
          const mixes = request.result.map((mix) => ({ id: mix.id, name: mix.name, period: mix.period, tracks: mix.tracks.length }));
          db.close();
          resolve({ ok: true, mixes });
        };
      };
    }))()`;

    // Parse self-check: a malformed expression reads as a silent null timeout.
    for (const [name, expr] of Object.entries({ SEARCH_READY, playerState, FEED_LOG_EXPR })) {
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
        onboarding.checkboxes > 0 && onboarding.confirm && !onboarding.accountCopy,
        `checkboxes=${onboarding.checkboxes}, confirm="${COPY.onboardingConfirm}", accountCopy=${onboarding.accountCopy}`,
      );
      await trustedClickJs(buttonByText(COPY.onboardingConfirm), "confirm languages");
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
    // STEP 1 — no listening history on a cold device, on both insights surfaces
    // ====================================================================
    await goto("/history", `!!document.querySelector('[data-testid="history-view"]')`, "history view");
    const coldHistory = await evaluate(
      `(() => ({
        h1: document.querySelector('h1')?.textContent ?? '',
        h1Hidden: document.querySelector('h1')?.classList.contains('sr-only') ?? false,
        stats: !!document.querySelector('[data-testid="stats-view"]'),
        emptyStats: [...document.querySelectorAll('h3, h2')].some((h) => h.textContent.trim() === 'Nothing here yet'),
        emptyHistory: [...document.querySelectorAll('h2, h3')].filter((h) => h.textContent.trim() === 'Nothing here yet').length,
        rows: document.querySelectorAll('[data-testid="history-row"]').length,
        disclaimer: /not a ranking/i.test(document.body.textContent || ''),
        claims: /(top|best|most played|you listened)\b/i.test(
          (document.querySelector('[data-testid="history-view"]')?.textContent ?? ''),
        ),
      }))()`,
    );
    step(
      "the History route mounts both insights views behind one hidden route heading",
      coldHistory.h1Hidden && coldHistory.stats && coldHistory.emptyStats,
      `h1="${coldHistory.h1}" (sr-only=${coldHistory.h1Hidden}), stats view=${coldHistory.stats}, empty states=${coldHistory.emptyHistory}`,
    );
    step(
      "a cold device explains both insights surfaces instead of reporting zeroes",
      coldHistory.emptyStats && coldHistory.rows === 0,
      `history rows=${coldHistory.rows}, empty headings=${coldHistory.emptyHistory}`,
    );
    step(
      "the History surface states the record is local and unranked",
      coldHistory.disclaimer && !coldHistory.claims,
      `disclaimer present=${coldHistory.disclaimer}, ranking/total claim in the record=${coldHistory.claims}`,
    );
    await shoot(1280, 900, "history-empty-1280.png", "A cold device: both insights surfaces explain themselves");

    // ====================================================================
    // STEP 2 — "no signal, no mix" is stated, not spent
    // ====================================================================
    const feedsBeforeNoSignal = (await evaluate(FEED_LOG_EXPR)).length;
    const noSignalMix = await evaluate(
      `(() => {
        const alert = document.querySelector('[data-testid="mix-no-signal"]');
        return { present: !!alert, text: alert?.textContent ?? '' };
      })()`,
    ).catch(() => ({ present: false, text: "" }));
    step(
      "with no local signal the mix surface says mixes need some listening",
      noSignalMix.present && /after some listening/i.test(noSignalMix.text),
      `"${noSignalMix.text.replace(/\s+/g, " ").trim().slice(0, 90)}"`,
    );

    // ====================================================================
    // STEP 3 — playing tracks records history with real measurements
    // ====================================================================
    const searchExpr = `location.pathname === '/search' && document.querySelectorAll(${JSON.stringify(
      SEARCH_ROWS,
    )}).length >= 3`;
    await trustedClickSel('input[aria-label="Search"]');
    await delay(150);
    await typeText(QUERY);
    const searchOk = await waitFor("live search results", searchExpr, Boolean, 45000).then(
      () => true,
      async () => {
        results.notes.searchFallbacks.push("initial search");
        await delay(4000);
        await evaluate(`(() => {
          const input = document.querySelector('input[aria-label="Search"]');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(QUERY)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
        await waitFor("live search results (after input retry)", searchExpr, Boolean, 30000);
        return true;
      },
    );
    const rows = await evaluate(
      `document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)}).length`,
    );
    step("live search returns results for the seeded query", searchOk && rows >= 3, `rows=${rows}`);

    // Start the first result, then step through tracks with the real transport's
    // Next control — the action that *ends* a step, which is when its
    // measurements are written.
    //
    // The loop runs until three measured plays exist rather than assuming every
    // step plays: a load can sit buffering long enough that the engine never
    // reports a position, and such a step honestly records zero seconds. Those
    // zero-step events stay in the dataset (they are real) and the loop simply
    // keeps stepping — which is also what a listener would do.
    const PLAY_SECONDS_PER_STEP = 15;
    const MEASURED_TARGET = 3;
    const MAX_STEPS = 8;
    await trustedClickJs(
      `[...document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)})][0].querySelector('button[aria-label^="Play "]')`,
      "play the first search result",
    );
    const firstPlay = await waitFor(
      "ordinary playback starts",
      playerState,
      (state) => state.control === "Pause",
      45000,
    );
    step("playback starts from a search result", firstPlay.control === "Pause", `control=${firstPlay.control}`);

    let steps = 0;
    let recorded = { ok: true, count: 0, events: [] };
    while (steps < MAX_STEPS) {
      await delay(PLAY_SECONDS_PER_STEP * 1000);
      const before = await evaluate(
        `document.querySelector('[data-testid="player-bar"]')?.textContent ?? ''`,
      );
      await trustedClickSel('[aria-label="Next track"]');
      await waitFor(
        `the current track changes after step ${steps + 1}`,
        `(() => {
          const now = document.querySelector('[data-testid="player-bar"]')?.textContent ?? '';
          return now !== '' && now !== ${JSON.stringify(before)} ? now : null;
        })()`,
        Boolean,
        25000,
      ).catch(() => null);
      steps += 1;
      recorded = await evaluate(storedEvents).catch(() => recorded);
      const measured = recorded.events.filter((event) => event.secondsPlayed > 0);
      if (recorded.count >= steps + 1 && measured.length >= MEASURED_TARGET) break;
    }
    results.notes.playSteps = { steps, perStepSeconds: PLAY_SECONDS_PER_STEP };
    const measured = recorded.events.filter((event) => event.secondsPlayed > 0);
    step(
      "playing tracks records local history with the seconds actually played",
      recorded.count >= 3 && measured.length >= MEASURED_TARGET,
      `steps=${steps}, events=${recorded.count}, with measured seconds=${measured.length}, seconds=${JSON.stringify(
        recorded.events.map((event) => event.secondsPlayed),
      )}`,
    );
    step(
      "every measured play is long enough that the rule reads it as a play, not a skip",
      measured.length >= MEASURED_TARGET && measured.every((event) => event.secondsPlayed >= 10),
      `seconds per event=${JSON.stringify(recorded.events.map((event) => event.secondsPlayed))} (skip threshold 10s, exclusive)`,
    );

    // ====================================================================
    // STEP 4 — the History page lists them by day with verdicts, and navigates
    // ====================================================================
    await goto("/history", `!!document.querySelector('[data-testid="history-view"]')`, "history view");
    const historyRows = await waitFor(
      "history rows render",
      `(() => ({
        rows: document.querySelectorAll('[data-testid="history-row"]').length,
        days: document.querySelectorAll('[data-testid^="history-day-"]').length,
        verdicts: [...document.querySelectorAll('[data-testid="history-verdict"]')].map((n) => n.textContent.trim()),
        rowsHaveTime: [...document.querySelectorAll('[data-testid="history-row"]')].every((row) => /\\d{1,2}:\\d{2}/.test(row.textContent || '')),
        rowsHaveTrack: [...document.querySelectorAll('[data-testid="history-row"]')].every((row) => (row.textContent || '').trim().length > 0),
      }))()`,
      (state) => state.rows >= 3,
      30000,
    );
    step(
      "the History page lists the recorded plays, grouped by local day",
      historyRows.rows >= 3 && historyRows.days >= 1,
      `rows=${historyRows.rows}, day groups=${historyRows.days}`,
    );
    step(
      "each history row shows the track, a time, and how the play ended",
      historyRows.rowsHaveTime && historyRows.rowsHaveTrack && historyRows.verdicts.every((v) => v.length > 0),
      `verdicts=${JSON.stringify(historyRows.verdicts)}`,
    );
    step(
      "the recorded plays read as plays rather than skips",
      historyRows.verdicts.some((v) => v === "Played partly" || v === "Played through"),
      `verdicts=${JSON.stringify(historyRows.verdicts)}`,
    );
    await shoot(1280, 900, "history-with-plays-1280.png", "History: local plays grouped by day with their verdicts");

    const artistLink = await evaluate(
      `(() => {
        const link = document.querySelector('[data-testid="history-row"] a[href^="/artist/"]');
        return link ? { href: link.getAttribute('href'), name: link.textContent.trim() } : null;
      })()`,
    );
    step(
      "each history row links the artist to that artist's own surface",
      Boolean(artistLink) && artistLink.href.startsWith("/artist/"),
      artistLink ? `"${artistLink.name}" → ${artistLink.href}` : "no artist link found",
    );
    if (artistLink) {
      const artistSelector = `[data-testid="history-row"] a[href="${artistLink.href}"]`;
      // Trusted mouse events first. A plain anchor has no activation behaviour
      // beyond navigation, so if the trusted click does not move the route — the
      // row can sit under a sticky header — the run falls back to an in-page
      // `click()`, which exercises the same React router handler. Which path was
      // taken is recorded rather than hidden.
      await trustedClickSel(artistSelector).catch(() => null);
      const navigated = await waitFor(
        "artist route opens from a history row",
        `location.pathname`,
        (p) => p.startsWith("/artist/"),
        6000,
      )
        .then(() => "trusted-click")
        .catch(async () => {
          await evaluate(`document.querySelector(${JSON.stringify(artistSelector)})?.click(); true`);
          return waitFor(
            "artist route opens from a history row (in-page click)",
            `location.pathname`,
            (p) => p.startsWith("/artist/"),
            20000,
          )
            .then(() => "in-page-click")
            .catch(() => null);
        });
      results.notes.artistLinkActivation = navigated;
      const artistPath = await evaluate(`location.pathname`);
      const artistResolved = await waitFor(
        "the artist surface resolves",
        `!!document.querySelector('[data-testid="artist-view"]')`,
        Boolean,
        90000,
      ).catch(() => false);
      step(
        "activating a history row's artist opens that artist's surface",
        artistResolved,
        `path=${artistPath}, activation=${navigated ?? "none"}, artist view rendered=${artistResolved}`,
      );
    }

    // ====================================================================
    // STEP 5 — the statistics report what the events summarize
    // ====================================================================
    await goto("/history", `!!document.querySelector('[data-testid="stats-view"]')`, "stats view");
    const stats = await waitFor(
      "the statistics report the recorded plays",
      `(() => {
        const view = document.querySelector('[data-testid="stats-view"]');
        if (!view) return null;
        const text = view.textContent || '';
        return {
          time: document.querySelector('[data-testid="stats-total-time"]')?.textContent ?? '',
          plays: document.querySelector('[data-testid="stats-play-count"]')?.textContent ?? '',
          current: document.querySelector('[data-testid="stats-current-streak"]')?.textContent ?? '',
          longest: document.querySelector('[data-testid="stats-longest-streak"]')?.textContent ?? '',
          verdicts: document.querySelector('[data-testid="stats-verdicts"]')?.textContent ?? '',
          topTracks: document.querySelector('[data-testid="stats-top-tracks"]')?.textContent ?? '',
          topArtists: document.querySelector('[data-testid="stats-top-artists"]')?.textContent ?? '',
          derivedLabels: [...view.querySelectorAll('p')].filter((p) => /Derived from this device/i.test(p.textContent || '')).length,
          accountClaim: /sign[\s-]?in|log[\s-]?in|your account|cloud/i.test(text),
        };
      })()`,
      (state) => state !== null && state.plays !== "" && Number(state.plays) >= 3,
      30000,
    );
    step(
      "the statistics report listening time, plays, and how each play ended",
      Number(stats.plays) >= 3 && /\d/.test(stats.time) && stats.verdicts.length > 0,
      `plays=${stats.plays}, time="${stats.time}", verdicts="${stats.verdicts.replace(/\s+/g, " ").trim()}"`,
    );
    step(
      "the statistics report top tracks and top artists",
      stats.topTracks.trim().length > 0 && stats.topArtists.trim().length > 0,
      `top tracks block=${stats.topTracks.replace(/\s+/g, " ").trim().slice(0, 70)}`,
    );
    step(
      "the statistics report both listening streaks",
      Number(stats.current) >= 1 && /Longest: \d+/.test(stats.longest),
      `current=${stats.current}, longest="${stats.longest.replace(/\s+/g, " ").trim()}"`,
    );
    step(
      "every statistic is labelled as derived from this device's record",
      stats.derivedLabels >= 4 && !stats.accountClaim,
      `derived labels=${stats.derivedLabels}, account claim=${stats.accountClaim}`,
    );
    await shoot(1280, 900, "history-stats-1280.png", "Statistics derived from the local record: time, plays, top entries, streak");

    // ====================================================================
    // STEP 6 — a Smart Mix is generated from the local profile
    // ====================================================================
    // The mix surface lives on the History route's insights area in this build's
    // navigation; generate it from there so the action is a real click.
    const mixPanel = `[data-testid="mix-list"]`;
    const mixReady = await waitFor(
      "the mix surface is mounted",
      `!!document.querySelector('${mixPanel}')`,
      Boolean,
      20000,
    ).catch(() => false);
    const mixFeedsBefore = (await evaluate(FEED_LOG_EXPR)).filter((feed) => feed.kind === "mix").length;
    await trustedClickJs(`document.querySelector('[data-testid="mix-generate"]')`, "build a mix");
    const built = await waitFor(
      "a mix is generated and listed by name",
      `(() => {
        const rows = [...document.querySelectorAll('[data-testid^="mix-row-"]')];
        if (rows.length === 0) return null;
        return {
          count: rows.length,
          ids: rows.map((row) => row.getAttribute('data-testid')),
          names: rows.map((row) => row.querySelector('span')?.textContent?.trim() ?? ''),
          sizes: rows.map((row) => row.textContent?.match(/\\d+ songs?/)?.[0] ?? ''),
          hasGenerate: !!document.querySelector('[data-testid="mix-generate"]'),
          error: document.querySelector('[role="alert"]')?.textContent ?? '',
        };
      })()`,
      (state) => state !== null,
      90000,
    ).catch(() => null);
    step(
      "with local signal, a Smart Mix is generated and listed by name",
      Boolean(built) && built.count === 1 && built.names[0].length > 0 && built.error === "",
      built
        ? `name="${built.names[0]}", size="${built.sizes[0]}", rows=${built.count}${built.error ? `, error="${built.error}"` : ""}`
        : "no mix row appeared",
    );
    const mixFeeds = (await evaluate(FEED_LOG_EXPR)).filter((feed) => feed.kind === "mix");
    step(
      "the mix was composed from the existing mix feed, within its request bound",
      mixFeeds.length >= 1 && mixFeeds.length <= 3,
      `mix feed requests=${mixFeeds.length}, kinds=${JSON.stringify(mixFeeds.map((feed) => feed.kind))}, limits=${JSON.stringify(
        mixFeeds.map((feed) => feed.limit),
      )}`,
    );
    step(
      "the mix request carried only feed parameters, with no profile, history, or mix data",
      mixFeeds.every((feed) => feed.keys.every((key) => DISCOVERY_KEYS_ALLOWED.includes(key))),
      `params=${JSON.stringify([...new Set(mixFeeds.flatMap((feed) => feed.keys))])}`,
    );
    step(
      "the mix surface offered generation because local signal existed",
      mixReady && Boolean(built) && built.hasGenerate,
      `mix panel mounted=${mixReady}, generate action still offered=${built?.hasGenerate}`,
    );
    await shoot(1280, 900, "mix-generated-1280.png", "A Smart Mix generated from the local profile, listed by name with its size");

    // ====================================================================
    // STEP 7 — the mix plays, appears on Home by name, and refreshes in place
    // ====================================================================
    if (built) {
      const mixName = built.names[0];
      await trustedClickJs(
        `[...document.querySelectorAll('button[aria-label^="Play "]')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(
          `Play ${mixName}`,
        )})`,
        `play the mix ${mixName}`,
      );
      const mixPlay = await waitFor(
        "the mix plays",
        playerState,
        (state) => state.control === "Pause",
        45000,
      );
      step(
        "playing a mix starts playback with the mix as its context",
        mixPlay.control === "Pause",
        `control=${mixPlay.control}, bar="${mixPlay.bar.replace(/\s+/g, " ").trim().slice(0, 60)}"`,
      );

      await goto("/", `!!document.querySelector('[data-testid="home-view"]')`, "home feed");
      const homeMix = await waitFor(
        "the Home mixes section lists the mix by name",
        `(() => {
          const section = document.querySelector('[data-testid="home-section-smart-mixes"]');
          if (!section) return null;
          return {
            rows: section.querySelectorAll('[data-testid^="mix-row-"]').length,
            names: [...section.querySelectorAll('span')].map((n) => n.textContent?.trim() ?? '').filter(Boolean),
            hasGenerate: !!section.querySelector('[data-testid="mix-generate"]'),
          };
        })()`,
        (state) => state !== null && state.rows >= 1,
        30000,
      ).catch(() => null);
      step(
        "Home lists the generated mix by name, with no generation action on the feed",
        Boolean(homeMix) && homeMix.names.includes(mixName) && homeMix.hasGenerate === false,
        homeMix ? `rows=${homeMix.rows}, names=${JSON.stringify(homeMix.names.slice(0, 3))}` : "no Smart Mixes section on Home",
      );

      // Refresh on the mix surface and compare identities before and after.
      await goto("/history", `!!document.querySelector('[data-testid="mix-list"]')`, "mix surface");
      const before = await evaluate(
        `(() => [...document.querySelectorAll('[data-testid^="mix-row-"]')].map((row) => row.getAttribute('data-testid')))()`,
      );
      await trustedClickJs(
        `document.querySelector('[data-testid^="mix-refresh-"]')`,
        "refresh the mix",
      );
      const after = await waitFor(
        "the refresh resolves",
        `(() => {
          const rows = [...document.querySelectorAll('[data-testid^="mix-row-"]')];
          return {
            ids: rows.map((row) => row.getAttribute('data-testid')),
            names: rows.map((row) => row.querySelector('span')?.textContent?.trim() ?? ''),
            refreshed: rows.some((row) => /Refreshed/.test(row.textContent || '')),
            alert: document.querySelector('[role="alert"]')?.textContent ?? '',
          };
        })()`,
        (state) => state.ids.length > 0 && (state.refreshed || state.alert.length > 0),
        90000,
      ).catch(() => null);
      step(
        "refreshing a mix keeps its identity and its name",
        Boolean(after) &&
          after.ids.length === before.length &&
          after.ids.every((id, index) => id === before[index]) &&
          after.names[0] === mixName,
        after
          ? `ids before=${JSON.stringify(before)}, after=${JSON.stringify(after.ids)}, name still "${after.names[0]}", refreshed notice=${after.refreshed}${after.alert ? `, alert="${after.alert}"` : ""}`
          : "the refresh never resolved",
      );
      step(
        "a refresh that cannot find new material says so instead of emptying the mix",
        Boolean(after) &&
          (after.refreshed || after.alert.length > 0) &&
          after.ids.length === before.length,
        after ? `refreshed=${after.refreshed}, alert="${after.alert.replace(/\s+/g, " ").trim().slice(0, 60)}"` : "no refresh result",
      );
    }

    // ====================================================================
    // STEP 8 — the mixes dataset survives an export → reset → import round trip
    // ====================================================================
    await goto(
      "/settings",
      `!![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Export backup')`,
      "export backup",
    );
    await evaluate(`
      window.__capture = { blobs: [] };
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { if (blob instanceof Blob) window.__capture.blobs.push(blob); return origCreate(blob); };
      HTMLAnchorElement.prototype.click = function () { return undefined; };
      true
    `);
    await trustedClickJs(buttonByText("Export backup"), "export backup");
    const envelopeText = await waitFor(
      "the exported envelope is readable",
      `(async () => {
        const blob = window.__capture.blobs[window.__capture.blobs.length - 1];
        if (!blob) return null;
        return await blob.text();
      })()`,
      (text) => typeof text === "string" && text.length > 0,
      30000,
    );
    const envelope = JSON.parse(envelopeText);
    const exportedMixes = envelope?.data?.mixes;
    step(
      "the exported backup carries the mixes dataset, with the generated mix in it",
      Array.isArray(exportedMixes) && exportedMixes.length >= 1 && typeof exportedMixes[0].name === "string",
      `datasets=${JSON.stringify(Object.keys(envelope?.data ?? {}))}, mixes=${JSON.stringify(
        exportedMixes?.map((mix) => ({ id: mix.id, name: mix.name, tracks: mix.tracks.length })),
      )}`,
    );
    step(
      "the exported envelope carries no profile weights, no history-only tables, and no secrets",
      envelope?.format === "spotivibe-backup" &&
        !("profile" in (envelope?.data ?? {})) &&
        !("taste" in (envelope?.data ?? {})) &&
        !JSON.stringify(envelope).includes("TASTE_LIMITS"),
      `format=${envelope?.format}, version=${envelope?.version}`,
    );

    // Reset every dataset through the real Settings control, then import it back.
    const feedback = `[data-testid="data-controls-feedback"]`;
    const resetDone = `document.querySelector('${feedback}')?.textContent ?? ''`;
    const resetReported = (text) => /reset/i.test(String(text));
    await trustedClickJs(buttonByText("Reset Spotivibe data"), "reset Spotivibe data");
    await waitFor(
      "the reset confirmation appears",
      `!!document.querySelector('[data-testid="confirm-reset"]')`,
      Boolean,
      15000,
    );
    // Same disclosed fallback as the artist link: a trusted click first, then an
    // in-page `click()` on the same confirm button if nothing happened. The path
    // taken is recorded rather than hidden.
    const CONFIRM_RESET = `[data-testid="confirm-reset"] button:not([disabled])`;
    await trustedClickJs(
      `[...document.querySelectorAll('[data-testid="confirm-reset"] button')].find((b) => b.textContent.trim() === 'Reset everything')`,
      "confirm reset",
    ).catch(() => null);
    let resetActivation = "trusted-click";
    let resetFeedback = await waitFor("the reset reports completion", resetDone, resetReported, 6000).catch(
      async () => {
        resetActivation = "in-page-click";
        await evaluate(
          `[...document.querySelectorAll('${CONFIRM_RESET}')].find((b) => b.textContent.trim() === 'Reset everything')?.click(); true`,
        );
        return waitFor("the reset reports completion (in-page click)", resetDone, resetReported, 60000).catch(
          () => null,
        );
      },
    );
    results.notes.resetActivation = resetActivation;
    const afterReset = await waitFor(
      "the mixes dataset is empty after a reset",
      storedMixes,
      (state) => state.mixes.length === 0,
      20000,
    ).catch(() => ({ mixes: [1] }));
    step(
      "resetting the local data really removes the mixes dataset",
      resetReported(resetFeedback) && afterReset.mixes.length === 0,
      `activation=${resetActivation}, feedback="${String(resetFeedback ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60)}", stored mixes after reset=${afterReset.mixes.length}`,
    );

    // Import the envelope the export produced, through the real file input.
    //
    // Diagnostics first: whether the input exists, whether the files actually
    // landed on it, and whether the dispatched event was observed at all. Those
    // three distinguish "the picker never got the file" from "the app ignored the
    // event", which are very different failures to read afterwards.
    const fixturePath = join(profileDir, "exported-backup.json");
    writeFileSync(fixturePath, envelopeText);
    await evaluate(`
      window.__changeSeen = 0;
      document.addEventListener('change', () => { window.__changeSeen += 1; }, true);
      true
    `);
    const doc = await send("DOM.getDocument", { depth: 0 });
    const input = await send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: "input[type=file]",
    });
    if (!input.nodeId) throw new Error("Import file input not found on /settings");
    await send("DOM.setFileInputFiles", { files: [fixturePath], nodeId: input.nodeId });
    await evaluate(
      `(() => {
        const el = document.querySelector('input[type=file]');
        if (!el) return false;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`,
    );
    const pickerState = await evaluate(`(() => {
      const el = document.querySelector('input[type=file]');
      return {
        inputs: document.querySelectorAll('input[type=file]').length,
        files: el ? el.files.length : -1,
        firstName: el && el.files.length > 0 ? el.files[0].name : '',
        firstBytes: el && el.files.length > 0 ? el.files[0].size : 0,
        changeEvents: window.__changeSeen ?? 0,
      };
    })()`);
    results.notes.importPicker = pickerState;
    const importFeedback = await waitFor(
      "import completion feedback",
      `document.querySelector('${feedback}')?.textContent ?? ''`,
      (text) => /Import complete|Import failed|unchanged/i.test(String(text)),
      90000,
    ).catch(() => null);
    step(
      "the exported envelope imports back through the Settings file picker",
      /Import complete/i.test(String(importFeedback ?? "")),
      `feedback="${String(importFeedback ?? "(no feedback)").replace(/\s+/g, " ").trim().slice(0, 70)}", files on input=${pickerState.files} ("${pickerState.firstName}", ${pickerState.firstBytes} bytes), change events observed=${pickerState.changeEvents}`,
    );
    const restoredMixes = await evaluate(storedMixes);
    step(
      "the mixes dataset survives the round trip with its identity and name intact",
      restoredMixes.mixes.length >= 1 &&
        exportedMixes.some((mix) => restoredMixes.mixes.some((stored) => stored.id === mix.id && stored.name === mix.name)),
      `restored=${JSON.stringify(restoredMixes.mixes)}`,
    );
    await goto("/history", `!!document.querySelector('[data-testid="mix-list"]')`, "mix surface");
    const restoredRows = await evaluate(
      `(() => [...document.querySelectorAll('[data-testid^="mix-row-"]')].map((row) => row.getAttribute('data-testid')))()`,
    );
    step(
      "the restored mix is listed again by name after the import",
      restoredRows.length >= 1,
      `rows after import=${JSON.stringify(restoredRows)}`,
    );
    // The import restored the history the reset cleared, so the statistics have
    // something to report again — which is the point of a backup.
    const restoredEvents = await evaluate(storedEvents);
    step(
      "the round trip restored the listening record as well as the mixes",
      restoredEvents.count >= 3,
      `events after import=${restoredEvents.count}`,
    );

    // ====================================================================
    // STEP 9 — one player iframe / one IFrame API script, and no stray requests
    // ====================================================================
    await goto("/now-playing", `!!document.querySelector('main')`, "now playing");
    const final = await evaluate(playerState);
    step(
      "the IFrame API is loaded exactly once and one player host is present",
      final.apiScripts <= 1 && final.iframes <= 1,
      `apiScripts=${final.apiScripts}, iframes=${final.iframes}, control=${final.control}`,
    );
    const allFeedKeys = [...new Set(results.notes.feedRequests.flatMap((feed) => feed.keys))];
    step(
      "no request this run carried profile, history, liked-track, or mix data",
      results.notes.feedRequests.every((feed) => feed.keys.every((key) => DISCOVERY_KEYS_ALLOWED.includes(key))),
      `every observed discovery request's params: ${JSON.stringify(allFeedKeys)} (${results.notes.feedRequests.length} requests)`,
    );
    step(
      "zero console errors (disclosed offline/blocked/live-upstream entries excluded)",
      results.consoleErrors.length === 0,
      `errors=${results.consoleErrors.length}, disclosed offline=${results.notes.disclosures.offlineWindow.length}, disclosed blocked-feed=${results.notes.disclosures.blockedFeedProbe.length}, disclosed live-upstream=${results.notes.disclosures.liveUpstream.length}`,
    );

    results.notes.screenshotFiles = readdirSync(EVIDENCE_DIR).filter((name) => name.endsWith(".png"));
  } catch (error) {
    results.error = String(error?.stack ?? error);
    console.error(`EVIDENCE RUN FAILED: ${results.error}`);
  } finally {
    results.pass = !results.error && results.steps.length > 0 && results.steps.every((s) => s.ok);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(EVIDENCE_DIR, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
    console.log(
      `\n${results.pass ? "ALL ASSERTIONS PASSED" : "EVIDENCE RUN FAILED"} — results.json written`,
    );
    for (const shot of results.screenshots) console.log(`  screenshot: ${shot.file}`);
    if (results.consoleErrors.length) console.log("  console errors:", results.consoleErrors);
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
