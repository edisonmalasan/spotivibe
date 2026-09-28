#!/usr/bin/env node
/**
 * M5 task 8.3 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Adapted from the M4 harness
 * (`openspec/changes/archive/2026-09-28-add-playback-engine/evidence/cdp-check.mjs`):
 * the browser discovery / CDP plumbing / assert / screenshot / console-error
 * infrastructure is reused; every step flow below is M5 search behavior.
 *
 * Drives a production build (`next start`) in headless Edge over the Chrome
 * DevTools Protocol to capture what unit tests cannot:
 *   1. typing in the top bar from Home keeps focus on the input across the
 *      navigation to `/search`, drops no characters, writes `/search?q=...`,
 *      and renders real remote results;
 *   2. fast typing never renders a superseded query's results (sampled twice);
 *   3. a trusted click on a song result starts real playback whose position
 *      advances, then Home → Search → Library → Now Playing keeps the SAME
 *      connected iframe and uninterrupted playback;
 *   4. a fresh `/search?q=` deep link never autoplays (transport Play, static
 *      position over a 3 s window) and carries exactly one IFrame API script;
 *   5. the result context menu exposes Play / like / Add to playlist /
 *      Go to artist and the liked state shows after activating like;
 *   6. a settled query appears in Recent searches; remove-one keeps the rest
 *      and survives reload; clear-all empties and stays empty across reload;
 *   7. a nonsense query renders an empty state that names the query;
 *   8. with CDP offline emulation, `navigator.onLine` flips and the search
 *      issues NO `/api/search` request — the local library answers instead;
 *   9. zero console errors and ≥4 screenshots for the whole session.
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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EVIDENCE_DIR = dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.env.SPOTIVIBE_ORIGIN ?? "http://localhost:3210";
const CDP_PORT = Number(process.env.SPOTIVIBE_CDP_PORT ?? 9445);

const BROWSER_CANDIDATES = [
  process.env.SPOTIVIBE_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Queries used by the run — recorded into results.json for reproduction. */
const QUERY_TYPED = "never gonna give you up"; // step 1 + step 4 deep link
const QUERY_SUPERSEDED = "bohemian rhapsody"; // step 2 first (fast) query
const QUERY_FINAL = "imagine john lennon"; // step 2 final (rapid) query
const QUERY_NONSENSE = "zzqqxxyy12345unique"; // step 7 empty state

function findBrowser() {
  const found = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("No Edge/Chrome executable found (set SPOTIVIBE_BROWSER_PATH).");
  return found;
}

/**
 * Installed before every document so the `/api/search` fetch count is
 * observable from the page (step 2 evidence + step 8 "no request issued").
 */
const SPY_SCRIPT = `(() => {
  if (window.__searchSpyInstalled) return;
  window.__searchSpyInstalled = true;
  window.__docStamp = Date.now();
  window.__searchRequests = [];
  const original = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input && input.url ? input.url : "";
      if (url.indexOf("/api/search") !== -1) window.__searchRequests.push({ url: url, at: Date.now() });
    } catch (error) {
      /* never break the app's fetch */
    }
    return original.call(this, input, init);
  };
})();`;

/** Player-region DOM sample: transport, clock, title, iframe identity. */
const PLAYER_STATE = `(() => {
  const bar = document.querySelector('[data-testid="player-bar"]');
  const control = bar?.querySelector('button[aria-label="Play"], button[aria-label="Pause"]');
  const link = document.querySelector('[data-testid="player-bar"] a[href="/now-playing"]');
  const all = [...document.querySelectorAll('iframe')];
  return {
    control: control?.getAttribute('aria-label') ?? null,
    position: bar?.querySelector('[data-testid="progress-position"]')?.textContent ?? null,
    duration: bar?.querySelector('[data-testid="progress-duration"]')?.textContent ?? null,
    title: link?.querySelector('.truncate')?.textContent ?? null,
    error: bar?.querySelector('[role="alert"]')?.textContent ?? null,
    dock: !!document.querySelector('[data-testid="player-dock"]'),
    iframe: !!document.querySelector('[data-testid="player-dock"] iframe'),
    iframeCount: document.querySelectorAll('[data-testid="player-dock"] iframe').length,
    youtubeIframes: all.filter((f) => (f.getAttribute('src') || '').indexOf('youtube.com/embed') !== -1).length,
    totalIframes: all.length,
    iframeApiScripts: document.querySelectorAll('script[src*="iframe_api"]').length,
  };
})()`;

/** Search-surface DOM sample: rows, sections, notices, input, URL. */
const SEARCH_STATE = `(() => {
  const rows = [...document.querySelectorAll('[data-testid="search-results"] li')];
  const heads = [...document.querySelectorAll('h2')].map((h) => h.textContent ?? '');
  const input = document.querySelector('input[aria-label="Search"]');
  return {
    rows: rows.length,
    texts: rows.slice(0, 8).map((li) => (li.textContent || '').replace(/\\s+/g, ' ').trim()),
    loading: !!document.querySelector('[data-testid="search-loading"]'),
    topResult: !!document.querySelector('[data-testid="top-result"]'),
    emptyTitle: heads.find((t) => t.indexOf('No results for') !== -1) ?? null,
    offlineEmptyTitle: heads.find((t) => t.indexOf('No local results for') !== -1) ?? null,
    errorTitle: heads.find((t) => t.indexOf('Search failed') !== -1) ?? null,
    browseTitle: heads.find((t) => t === 'Search for music') ?? null,
    notice: document.querySelector('[data-testid="fallback-notice"]')?.textContent ?? null,
    inputValue: input?.value ?? null,
    focused: document.activeElement === input,
    sameAsStamp: window.__searchInputEl ? document.activeElement === window.__searchInputEl : null,
    stampConnected: window.__searchInputEl ? window.__searchInputEl.isConnected : null,
    path: location.pathname,
    q: new URLSearchParams(location.search).get('q'),
  };
})()`;

/** Recent-searches browse surface. */
const RECENTS_STATE = `(() => {
  const section = document.querySelector('section[aria-labelledby="recent-searches-heading"]');
  const items = section
    ? [...section.querySelectorAll('ul li')].map((li) => ({
        query: li.querySelector('button:not([aria-label])')?.textContent?.trim() ?? null,
        removeLabel: li.querySelector('button[aria-label^="Remove"]')?.getAttribute('aria-label') ?? null,
      }))
    : [];
  const heads = [...document.querySelectorAll('h2')].map((h) => h.textContent ?? '');
  return {
    heading: section !== null,
    items: items,
    browseEmpty: heads.some((t) => t === 'Search for music'),
    path: location.pathname,
    q: new URLSearchParams(location.search).get('q'),
    inputValue: document.querySelector('input[aria-label="Search"]')?.value ?? null,
  };
})()`;

/** Open context-menu item names. */
const MENU_STATE = `(() => {
  const menu = document.querySelector('[role="menu"]');
  if (!menu) return { open: false, items: [] };
  return {
    open: true,
    label: menu.getAttribute('aria-label') ?? null,
    items: [...menu.querySelectorAll('[role="menuitem"]')].map((i) => (i.textContent ?? '').trim()),
  };
})()`;

function parseClock(text) {
  if (typeof text !== "string") return null;
  const parts = text.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

async function main() {
  const results = {
    task: "8.3",
    change: "add-search-experience",
    milestone: "M5",
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    target: `${ORIGIN}/`,
    queries: {
      typed: QUERY_TYPED,
      superseded: QUERY_SUPERSEDED,
      final: QUERY_FINAL,
      nonsense: QUERY_NONSENSE,
    },
    steps: [],
    screenshots: [],
    consoleErrors: [],
    notes: {},
    pass: false,
  };
  const step = (name, ok, detail = "") => {
    results.steps.push({ name, ok: !!ok, detail: String(detail).slice(0, 500) });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    return !!ok;
  };

  let browser;
  let ws;
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  const profileDir = mkdtempSync(join(tmpdir(), "spotivibe-cdp-search-"));

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
        `Production server not reachable at ${ORIGIN} — run "npm run build" then "npm run start" first.`,
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
        await delay(250);
      }
      throw new Error(`Timed out waiting for ${description} (last: ${JSON.stringify(last)})`);
    };
    /** Real input events over CDP — a trusted user gesture (autoplay policy).
     *  `rectExpr` evaluates to `{x, y, w, h}` (center point) plus whatever
     *  diagnostics the caller attached, so a miss reports what was found. */
    const trustedClickAt = async (rectExpr, label) => {
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
    const rectOf = (selector) => `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height };
    })()`;
    const trustedClick = async (selector) => trustedClickAt(rectOf(selector), selector);
    /** Printable characters, dispatched as trusted `char` events (Puppeteer's
     *  `sendCharacter` shape) so React's controlled input sees real typing. */
    const typeText = async (text, perCharMs = 30) => {
      for (const ch of text) {
        await send("Input.dispatchKeyEvent", { type: "char", text: ch, key: ch });
        if (perCharMs > 0) await delay(perCharMs);
      }
    };
    /** Non-printable key press (Ctrl+A, Backspace, Escape). */
    const keyPress = async ({ key, code, modifiers = 0, windowsVirtualKeyCode }) => {
      const base = { key, code, modifiers, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
      await delay(40);
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    };
    const INPUT = 'input[aria-label="Search"]';
    const focusInput = async () => {
      await trustedClick(INPUT);
      await delay(150);
      return evaluate(
        `document.activeElement === document.querySelector(${JSON.stringify(INPUT)}) && ((window.__searchInputEl = document.activeElement), true)`,
      );
    };
    const clearInput = async () => {
      const focused = await focusInput();
      if (!focused) throw new Error("search input could not be focused");
      await keyPress({ key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
      await delay(80);
      await keyPress({ key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
      await delay(120);
    };
    const shoot = async (width, height, file, note) => {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(600);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(EVIDENCE_DIR, file), Buffer.from(shot.data, "base64"));
      results.screenshots.push(note ? { file, width, height, note } : { file, width, height });
    };
    const searchRequests = () => evaluate(`(window.__searchRequests ?? []).map((r) => r.url)`);

    /** Hard reload that only resolves on the NEW document and waits for the
     *  client to hydrate — otherwise post-reload assertions can sample the
     *  outgoing document (both step-6 reloads raced exactly like that). */
    const reloadFresh = async (label) => {
      const stamp = Date.now();
      await send("Page.reload", {});
      await waitFor(`${label}: fresh document`, `window.__docStamp ?? 0`, (v) => v >= stamp, 20000);
      await waitFor(`${label}: document complete`, `document.readyState`, (r) => r === "complete", 20000);
      const marker = await waitFor(
        `${label}: client hydration`,
        `(() => {
          const input = document.querySelector('input[aria-label="Search"]');
          const reactOwned = !!input && Object.keys(input).some((k) => k.indexOf('__reactProps$') === 0);
          return reactOwned || !!document.querySelector('[data-testid="player-dock"]');
        })()`,
        Boolean,
        15000,
      ).catch(() => null);
      if (marker === null) await delay(2500); // no marker observed: give hydration time anyway
      return marker !== null;
    };
    const rowsDetail = (state) => `rows=${state.rows} top=${state.topResult} first="${(state.texts[0] ?? "").slice(0, 90)}"`;

    // ---- console error capture ----------------------------------------
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
      if (params.entry.level === "error") {
        results.consoleErrors.push(`log: ${params.entry.text}`.slice(0, 300));
      }
    });

    // Step 7's zero-track provider response (see the STEP 7 comment block):
    // paused at the CDP Fetch boundary only while `fetchStubActive` is set,
    // and only for the marker query — every other request continues untouched.
    let fetchStubActive = false;
    let fetchStubHits = 0;
    results.notes.fetchErrors = [];
    on("Fetch.requestPaused", (params) => {
      void (async () => {
        try {
          const url = params.request.url ?? "";
          const stub =
            fetchStubActive && url.includes("/api/search") &&
            new URL(url).searchParams.get("q") === QUERY_NONSENSE;
          if (stub) {
            // Request-stage pause → `fulfillRequest` (respondWithResponse is
            // the Response-stage command and would leave the request hanging).
            await send("Fetch.fulfillRequest", {
              requestId: params.requestId,
              responseCode: 200,
              responseHeaders: [
                { name: "Content-Type", value: "application/json" },
                { name: "Cache-Control", value: "no-store" },
              ],
              body: Buffer.from(JSON.stringify({ tracks: [] })).toString("base64"),
            });
            fetchStubHits += 1;
            return;
          }
          await send("Fetch.continueRequest", { requestId: params.requestId });
        } catch (error) {
          results.notes.fetchErrors.push(String(error?.message ?? error).slice(0, 300));
        }
      })();
    });

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("DOM.enable");
    await send("Network.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: SPY_SCRIPT });

    // =====================================================================
    // STEP 1 — top-bar input drives search from Home (spec R1)
    // =====================================================================
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: `${ORIGIN}/` });
    const inputReady = await waitFor(
      "top-bar search input on Home",
      SEARCH_STATE,
      (s) => s.inputValue !== null,
      30000,
    );
    step("Home renders with the top-bar search input", inputReady.path === "/", `path=${inputReady.path}`);

    const focused = await focusInput();
    step("top-bar search input focused on Home", focused, `focused=${focused}`);

    // Type the first half, then wait for the debounced navigation to begin
    // while the input is still mid-edit — focus must survive it (spec R1).
    await typeText("never gonna ", 40);
    const navigated = await waitFor(
      "navigation to /search to begin",
      SEARCH_STATE,
      (s) => s.path === "/search",
      8000,
    ).catch(() => null);
    const focusAfterNav =
      navigated !== null &&
      (await evaluate(
        `document.activeElement === window.__searchInputEl && window.__searchInputEl.isConnected === true`,
      ));
    step(
      "focus retained on the searchbox after navigation began (R1)",
      focusAfterNav,
      navigated
        ? `path=${navigated.path} value="${navigated.inputValue}" sameElement=${navigated.sameAsStamp}`
        : "navigation to /search never began",
    );

    await typeText("give you up", 40);
    await delay(200);
    const typed = await waitFor("typed input state", SEARCH_STATE, (s) => s.inputValue !== null, 5000);
    step(
      "typed value has no dropped characters",
      typed.inputValue === QUERY_TYPED,
      `value="${typed.inputValue}" expected="${QUERY_TYPED}"`,
    );
    step("searchbox still the active element after typing completed", typed.focused && typed.sameAsStamp,
      `focused=${typed.focused} sameAsStamp=${typed.sameAsStamp} stampConnected=${typed.stampConnected}`);

    const withUrl = await waitFor(
      "URL to carry the typed query",
      SEARCH_STATE,
      (s) => s.path === "/search" && s.q === QUERY_TYPED,
      10000,
    ).catch(() => null);
    step(
      "URL becomes /search?q=<typed query> and the input keeps the value",
      withUrl !== null && withUrl.inputValue === QUERY_TYPED,
      withUrl ? `path=${withUrl.path} q="${withUrl.q}" value="${withUrl.inputValue}"` : "URL never updated",
    );

    const remote = await waitFor(
      "remote results for the typed query",
      SEARCH_STATE,
      (s) => s.rows >= 1 && !s.loading && s.texts.some((t) => t.length > 0),
      40000,
    );
    step("Search route renders real remote results for the query", true, rowsDetail(remote));
    results.step1 = { final: remote, requests: await searchRequests() };

    // =====================================================================
    // STEP 2 — fast typing never shows stale results (spec R2)
    // =====================================================================
    await clearInput();
    const browse = await waitFor(
      "browse state after clearing the input",
      SEARCH_STATE,
      (s) => (s.browseTitle !== null || s.notice !== null || s.rows >= 0) && s.inputValue === "" && s.loading === false && s.rows === 0 && s.q === null,
      10000,
    ).catch(() => null);
    step(
      "clearing the input returns the surface to the browse state",
      browse !== null && browse.inputValue === "",
      browse ? `browseTitle=${JSON.stringify(browse.browseTitle)} q=${JSON.stringify(browse.q)}` : "browse state never appeared",
    );

    await typeText(QUERY_SUPERSEDED, 25);
    const inFlightDelay = 700; // > 300 ms debounce: the superseded request goes out
    await delay(inFlightDelay);
    await clearInput();
    await typeText(QUERY_FINAL, 25);

    const finalResults = await waitFor(
      "final query results",
      SEARCH_STATE,
      (s) => s.rows >= 1 && !s.loading && s.texts.some((t) => t.length > 0),
      40000,
    );
    await delay(2000); // settle + give any late superseded response time to land
    const sampleA = await evaluate(SEARCH_STATE);
    await delay(1500);
    const sampleB = await waitFor("second results sample", SEARCH_STATE, (s) => s.rows >= 1, 10000);

    const staleInA = sampleA.texts.filter((t) => /bohemian/i.test(t));
    const staleInB = sampleB.texts.filter((t) => /bohemian/i.test(t));
    const finalMatch = (sampleB.texts ?? []).some((t) => /imagine|lennon/i.test(t));
    step(
      "rapid typing settles on the final query's results",
      sampleB.rows >= 1 && finalMatch,
      rowsDetail(sampleB),
    );
    step(
      "no superseded-query titles rendered (sampled twice, 1.5 s apart)",
      staleInA.length === 0 && staleInB.length === 0,
      `supersededMatches sampleA=${JSON.stringify(staleInA)} sampleB=${JSON.stringify(staleInB)}`,
    );
    const step2Requests = await searchRequests();
    const finalRequest = step2Requests.find((u) => u.includes(`q=${encodeURIComponent(QUERY_FINAL)}`));
    const supersededRequest = step2Requests.find((u) =>
      u.includes(`q=${encodeURIComponent(QUERY_SUPERSEDED)}`),
    );
    results.step2 = { sampleA: sampleA.texts, sampleB: sampleB.texts, requests: step2Requests };
    step(
      "a /api/search request was issued for the final query (fetch spy)",
      finalRequest !== undefined,
      `finalRequest=${finalRequest ?? "none"} supersededRequest=${supersededRequest ?? "none"}`,
    );

    // =====================================================================
    // STEP 3 — result → real playback (trusted click) + persistence (R5)
    // =====================================================================
    const firstLabel = await evaluate(
      `(() => { const b = document.querySelector('[data-testid="search-results"] li:first-child button[aria-label^="Play "]'); return b ? b.getAttribute('aria-label') : null; })()`,
    );
    if (!firstLabel) throw new Error("No song row play button found in the results list");
    const clickedTitle = firstLabel.slice("Play ".length);
    results.step3 = { clickedTitle };

    await evaluate(
      `(() => { const el = document.querySelector('[data-testid="search-results"] li:first-child'); el?.scrollIntoView({ block: 'center' }); return !!el; })()`,
    );
    await delay(500);
    const clickPoint = await trustedClick(
      '[data-testid="search-results"] li:first-child button[aria-label^="Play "]',
    );
    results.step3.clickPoint = clickPoint;

    const afterClick = await waitFor(
      "transport to show Pause after the trusted click",
      PLAYER_STATE,
      (s) => s.control === "Pause",
      20000,
    ).catch(() => null);
    step(
      "trusted click on a song result starts playback (transport → Pause)",
      afterClick !== null,
      afterClick ? `control=${afterClick.control} error=${JSON.stringify(afterClick.error)}` : "never switched to Pause",
    );

    const showingTrack = await waitFor(
      "player region to show the clicked track",
      PLAYER_STATE,
      (s) => s.title === clickedTitle,
      15000,
    ).catch(() => null);
    step(
      "player region shows the clicked track",
      showingTrack !== null,
      showingTrack ? `title="${showingTrack.title}"` : `title=${JSON.stringify(showingTrack?.title)} expected="${clickedTitle}"`,
    );

    const docked = await waitFor("player iframe after click", PLAYER_STATE, (s) => s.iframe, 15000).catch(
      () => null,
    );
    step(
      "YouTube iframe exists after activating the result",
      docked !== null,
      docked ? `dock=${docked.dock} iframes=${docked.iframeCount} youtube=${docked.youtubeIframes}` : "no iframe",
    );

    if (docked) {
      // Stamp BEFORE navigation: identity after route changes proves the same
      // connected element persisted (M4 pattern, spec R5).
      await evaluate(
        `window.__m5iframe = document.querySelector('[data-testid="player-dock"] iframe'); true`,
      );
    }

    let positionBeforeNav = null;
    if (docked) {
      const pos1 = await waitFor(
        "playback position to reach 0:01",
        `(${PLAYER_STATE}).position`,
        (t) => (parseClock(t) ?? -1) >= 1,
        30000,
      ).catch(() => null);
      await delay(2500);
      const pos2 = await evaluate(`(${PLAYER_STATE}).position`);
      const advanced = pos1 !== null && (parseClock(pos2) ?? -1) > (parseClock(pos1) ?? -1);
      positionBeforeNav = parseClock(pos2) ?? parseClock(pos1) ?? 0;
      results.step3.positionStart = pos1;
      results.step3.positionAdvance = pos2;
      step(
        "playback position advances (real remote playback)",
        advanced,
        `${pos1} → ${pos2}`,
      );
      const counts = await evaluate(PLAYER_STATE);
      step(
        "exactly one IFrame API script and one YouTube iframe total",
        counts.iframeApiScripts === 1 && counts.youtubeIframes === 1 && counts.totalIframes === 1,
        `apiScripts=${counts.iframeApiScripts} youtubeIframes=${counts.youtubeIframes} totalIframes=${counts.totalIframes}`,
      );
      await shoot(1280, 900, "search-playing-1280.png", "song result playing, PlayerBar shows the track");
    }

    const nav = async (label, clickExpr, path) => {
      await evaluate(clickExpr);
      const at = await waitFor(`${label} route`, `location.pathname`, (p) => p === path, 15000).catch(
        () => null,
      );
      if (at === null) {
        step(`${label}: same connected iframe persists`, false, `never reached ${path}`);
        return;
      }
      const check = await waitFor(
        `${label} player state`,
        `(() => {
          const el = document.querySelector('[data-testid="player-dock"] iframe');
          const bar = document.querySelector('[data-testid="player-bar"] button[aria-label="Pause"], [data-testid="player-bar"] button[aria-label="Play"]');
          return { same: el === window.__m5iframe, connected: !!el && el.isConnected, control: bar?.getAttribute('aria-label') ?? null, path: location.pathname };
        })()`,
        (s) => s.path === path,
        10000,
      ).catch(() => null);
      const ok = check !== null && check.same && check.connected && check.control === "Pause";
      step(`${label}: SAME connected iframe + playback not interrupted`, ok, JSON.stringify(check));
    };

    await nav("Home", `document.querySelector('a[href="/"]').click(); true`, "/");
    await nav("Search", `document.querySelector('a[href="/search"]').click(); true`, "/search");
    await nav("Library", `document.querySelector('a[href="/library"]').click(); true`, "/library");
    await nav(
      "Now Playing",
      `document.querySelector('[data-testid="player-bar"] a[href="/now-playing"]').click(); true`,
      "/now-playing",
    );

    const finalPlayer = await waitFor("final player state", PLAYER_STATE, (s) => s.dock, 15000).catch(
      () => null,
    );
    if (finalPlayer && positionBeforeNav !== null) {
      const finalPos = parseClock(finalPlayer.position) ?? 0;
      step(
        "playback continued across the whole navigation (position not reset)",
        finalPos >= positionBeforeNav && finalPlayer.control === "Pause",
        `position ${positionBeforeNav}s → ${finalPos}s control=${finalPlayer.control}`,
      );
      step(
        "single IFrame API script / single YouTube iframe at the end of the route sequence",
        finalPlayer.iframeApiScripts === 1 && finalPlayer.youtubeIframes === 1 && finalPlayer.totalIframes === 1,
        `apiScripts=${finalPlayer.iframeApiScripts} youtubeIframes=${finalPlayer.youtubeIframes} totalIframes=${finalPlayer.totalIframes}`,
      );
    } else {
      step("playback continued across the whole navigation (position not reset)", false, "no final player state");
    }

    // =====================================================================
    // STEP 4 — no autoplay on a fresh /search?q= deep link (spec R5, R1)
    // =====================================================================
    await send("Page.navigate", { url: `${ORIGIN}/search?q=${encodeURIComponent(QUERY_TYPED)}` });
    const deepLink = await waitFor(
      "deep-linked input value",
      SEARCH_STATE,
      (s) => s.inputValue === QUERY_TYPED && s.path === "/search",
      20000,
    ).catch(() => null);
    step(
      "deep link /search?q=... seeds the top-bar input with the URL query",
      deepLink !== null && deepLink.q === QUERY_TYPED,
      deepLink ? `q=${JSON.stringify(deepLink.q)} value="${deepLink.inputValue}"` : "input never adopted the URL query",
    );

    const deepResults = await waitFor(
      "deep-linked query results",
      SEARCH_STATE,
      (s) => s.rows >= 1 && !s.loading,
      40000,
    ).catch(() => null);
    step(
      "deep-linked query searches and renders results",
      deepResults !== null,
      deepResults ? rowsDetail(deepResults) : "no results rendered",
    );

    const beforeClickSample = await evaluate(PLAYER_STATE);
    results.step4 = { sample: beforeClickSample };
    step(
      "no autoplay: transport still offers Play before any click on the fresh load",
      beforeClickSample.control === "Play",
      `control=${beforeClickSample.control} position=${beforeClickSample.position} dock=${beforeClickSample.dock} iframe=${beforeClickSample.iframe}`,
    );
    await delay(3000);
    const after3s = await evaluate(PLAYER_STATE);
    results.step4.after3s = after3s;
    step(
      "no autoplay: position static after 3 s (no playback started by the search surface)",
      after3s.control === "Play" && after3s.position === beforeClickSample.position,
      `control=${after3s.control} position ${beforeClickSample.position} → ${after3s.position}`,
    );
    step(
      "exactly one IFrame API script and one YouTube iframe on the deep link",
      after3s.iframeApiScripts === 1 && after3s.youtubeIframes === 1,
      `apiScripts=${after3s.iframeApiScripts} youtubeIframes=${after3s.youtubeIframes}`,
    );
    step(
      "top-bar input still focused/adapted state intact (value matches URL)",
      deepLink !== null && deepLink.inputValue === QUERY_TYPED,
      `value="${deepLink?.inputValue}"`,
    );
    results.step4.topResult = deepResults?.topResult ?? false;
    await shoot(
      1280,
      900,
      "search-results-1280.png",
      `results view for "${QUERY_TYPED}" (topResult=${deepResults?.topResult ?? "unknown"})`,
    );

    // =====================================================================
    // STEP 5 — context menu + like (spec "Result context actions")
    // =====================================================================
    const triggerLabel = await evaluate(
      `(() => { const b = document.querySelector('[data-testid="search-results"] li:first-child button[aria-haspopup="menu"]'); return b ? b.getAttribute('aria-label') : null; })()`,
    );
    const menuTitle = triggerLabel ? triggerLabel.replace(/^More options for /, "") : null;
    results.step5 = { triggerLabel, menuTitle };

    let menuOk = false;
    if (triggerLabel) {
      await evaluate(
        `(() => { const el = document.querySelector('[data-testid="search-results"] li:first-child'); el?.scrollIntoView({ block: 'center' }); return true; })()`,
      );
      await delay(400);
      await trustedClick('[data-testid="search-results"] li:first-child button[aria-haspopup="menu"]');
      const menu = await waitFor("context menu to open", MENU_STATE, (m) => m.open, 8000).catch(() => null);
      const items = menu?.items ?? [];
      menuOk =
        items.includes("Play") &&
        items.some((i) => /^(Save to|Remove from) Liked Songs$/.test(i)) &&
        items.includes("Add to playlist") &&
        items.includes("Go to artist");
      step(
        "context menu opens with accessible names (Play, like toggle, Add to playlist, Go to artist)",
        menuOk,
        JSON.stringify(items),
      );
      if (menu) results.step5.menuItems = items;
      await shoot(1280, 900, "search-context-menu-1280.png", `context menu open for "${menuTitle}"`);

      const likeIndex = await evaluate(`(() => {
        const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')];
        return items.findIndex((i) => /^(Save to|Remove from) Liked Songs$/.test((i.textContent ?? '').trim()));
      })()`);
      if (likeIndex >= 0) {
        await trustedClick(`[role="menu"] [role="menuitem"]:nth-child(${likeIndex + 1})`);
        const closed = await waitFor(
          "menu to close after activating like",
          MENU_STATE,
          (m) => !m.open,
          8000,
        ).catch(() => null);
        await delay(900); // repository write completes before the state re-reads
        await trustedClick('[data-testid="search-results"] li:first-child button[aria-haspopup="menu"]');
        const reopened = await waitFor("context menu reopened", MENU_STATE, (m) => m.open, 8000).catch(
          () => null,
        );
        const liked = (reopened?.items ?? []).includes("Remove from Liked Songs");
        step(
          "like activated → reopened menu shows the liked state",
          closed !== null && reopened !== null && liked,
          JSON.stringify(reopened?.items ?? []),
        );
        results.step5.itemsAfterLike = reopened?.items ?? [];
        await shoot(1280, 900, "search-liked-state-1280.png", `liked state for "${menuTitle}"`);
        await keyPress({ key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await delay(300);
      } else {
        step("like activated → reopened menu shows the liked state", false, "no like menu item found");
      }
    } else {
      step("context menu opens with accessible names (Play, like toggle, Add to playlist, Go to artist)", false, "no trigger button");
      step("like activated → reopened menu shows the liked state", false, "no trigger button");
    }

    // =====================================================================
    // STEP 6 — search history: record, remove-one, clear-all, reload (R7)
    // =====================================================================
    await clearInput();
    const recents = await waitFor(
      "recent searches browse surface",
      RECENTS_STATE,
      (s) => s.heading && s.inputValue === "",
      10000,
    ).catch(() => null);
    const initialEntries = recents?.items.map((i) => i.query) ?? [];
    results.step6 = { initialEntries };
    step(
      "settled queries appear in Recent searches after clearing the input",
      recents !== null && initialEntries.includes(QUERY_TYPED) && initialEntries.includes(QUERY_FINAL),
      JSON.stringify(initialEntries),
    );
    await shoot(1280, 900, "search-recents-1280.png", "browse state with recent searches");

    if (recents !== null && initialEntries.length > 0) {
      const removeTarget = initialEntries[0];
      const expectedAfter = initialEntries.filter((q) => q !== removeTarget);
      await trustedClick(`button[aria-label=${JSON.stringify(`Remove ${removeTarget}`)}]`);
      const afterRemove = await waitFor(
        "one recent entry removed",
        RECENTS_STATE,
        (s) => s.items.length < initialEntries.length,
        8000,
      ).catch(() => null);
      const nowEntries = afterRemove?.items.map((i) => i.query) ?? [];
      step(
        "remove-one deletes exactly that entry and leaves the rest",
        afterRemove !== null &&
          nowEntries.length === initialEntries.length - 1 &&
          !nowEntries.includes(removeTarget) &&
          expectedAfter.every((q) => nowEntries.includes(q)),
        `removed="${removeTarget}" now=${JSON.stringify(nowEntries)}`,
      );
      results.step6.removed = removeTarget;

      results.step6.hydratedAfterFirstReload = await reloadFresh("remove-one reload");
      const afterReload = await waitFor(
        "recents after reload (fresh document)",
        RECENTS_STATE,
        (s) => s.heading && s.items.length > 0,
        20000,
      ).catch(() => null);
      const reloadedEntries = afterReload?.items.map((i) => i.query) ?? [];
      step(
        "remaining recents survive reload (R7)",
        afterReload !== null &&
          reloadedEntries.length === expectedAfter.length &&
          expectedAfter.every((q) => reloadedEntries.includes(q)) &&
          !reloadedEntries.includes(removeTarget),
        JSON.stringify(reloadedEntries),
      );
      results.step6.afterReload = reloadedEntries;

      if (afterReload !== null && afterReload.heading) {
        // Locate "Clear all" by accessible text (with diagnostics attached) so
        // a miss reports what the browse surface actually contained.
        const clearAllRect = `(() => {
          const sec = document.querySelector('section[aria-labelledby="recent-searches-heading"]');
          const buttons = sec ? [...sec.querySelectorAll('button')] : [];
          const names = buttons.map((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim());
          const target = buttons.find((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim() === 'Clear all') ?? null;
          if (!target) return { w: 0, h: 0, found: false, sectionFound: !!sec, buttons: names };
          const r = target.getBoundingClientRect();
          return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height, sectionFound: !!sec, buttons: names };
        })()`;
        const clearClick = await trustedClickAt(clearAllRect, "Clear all").catch((error) => ({
          error: String(error?.message ?? error),
        }));
        if (clearClick.error) {
          results.notes.clearAllClickError = clearClick.error;
          step("clear-all empties the recent-searches list", false, clearClick.error);
          step("clear-all survives reload (stays empty)", false, "clear-all control never activated");
        } else {
          const cleared = await waitFor(
            "clear-all empties the list",
            RECENTS_STATE,
            (s) => !s.heading && s.browseEmpty,
            8000,
          ).catch(() => null);
          step(
            "clear-all empties the recent-searches list",
            cleared !== null,
            cleared ? `heading=${cleared.heading} browseEmpty=${cleared.browseEmpty}` : "list not emptied",
          );

          results.step6.hydratedAfterClearReload = await reloadFresh("clear-all reload");
          const afterClearReload = await waitFor(
            "browse state after clear-all reload (fresh document)",
            RECENTS_STATE,
            (s) => !s.heading && s.browseEmpty,
            20000,
          ).catch(() => null);
          step(
            "clear-all survives reload (stays empty)",
            afterClearReload !== null && !afterClearReload.heading && afterClearReload.browseEmpty,
            afterClearReload
              ? `heading=${afterClearReload.heading} browseEmpty=${afterClearReload.browseEmpty}`
              : "never reloaded",
          );
        }
      } else {
        step("clear-all empties the recent-searches list", false, "no recents heading after reload");
        step("clear-all survives reload (stays empty)", false, "no recents heading after reload");
      }
    } else {
      step("remove-one deletes exactly that entry and leaves the rest", false, "no recents to remove");
      step("remaining recents survive reload (R7)", false, "no recents to reload");
      step("clear-all empties the recent-searches list", false, "no recents to clear");
      step("clear-all survives reload (stays empty)", false, "no recents to clear");
    }

    // =====================================================================
    // STEP 7 — empty state names the query (spec "Empty, error, offline")
    //
    // Live-provider reality (observed, recorded in notes.remoteEmptyState):
    // YouTube answers EVERY text query with fuzzy matches — the example
    // nonsense query returned 2 tracks — and the M3 route contract maps an
    // all-empty provider chain to 503 `upstream_unavailable` (chain.ts only
    // returns ok when a tier yielded tracks; route.ts returns the structured
    // 503 otherwise). So a *successful* 200 with `tracks: []` cannot occur
    // against the real provider in this build.
    //
    // This step therefore (a) runs the nonsense query against the LIVE
    // provider and records exactly what came back, then (b) asserts the
    // specified scenario — a successful zero-match response renders the empty
    // state naming the query — with that one response stubbed at the CDP
    // Fetch boundary (labeled in the step name; every other request passes
    // through untouched).
    // =====================================================================
    await focusInput();
    await keyPress({ key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
    await delay(60);
    await keyPress({ key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    await delay(150);
    await typeText(QUERY_NONSENSE, 25);
    const liveObserved = await waitFor(
      "live provider response for the nonsense query",
      SEARCH_STATE,
      (s) => (s.rows >= 1 || s.emptyTitle !== null) && !s.loading,
      30000,
    ).catch(() => null);
    results.notes.remoteEmptyState = {
      liveProviderResponse: liveObserved
        ? { rows: liveObserved.rows, emptyTitle: liveObserved.emptyTitle, first: liveObserved.texts[0] ?? null }
        : "never settled",
      whyStubbed:
        "Live YouTube search returns fuzzy matches for any text (probes recorded in README), and /api/search returns 503 for an all-empty provider chain — a 200 with tracks:[] is unreachable against the real provider, so the zero-track response for this step was supplied via CDP Fetch.respondWithResponse.",
    };

    await send("Fetch.enable", { patterns: [{ urlPattern: "*api/search*", requestStage: "Request" }] });
    fetchStubActive = true;
    await clearInput();
    await waitFor(
      "browse state before the stubbed zero-track search",
      SEARCH_STATE,
      (s) => s.inputValue === "" && s.rows === 0 && s.loading === false,
      10000,
    ).catch(() => null);
    await typeText(QUERY_NONSENSE, 25);
    const empty = await waitFor(
      "empty state naming the query",
      SEARCH_STATE,
      (s) => s.emptyTitle === `No results for "${QUERY_NONSENSE}"`,
      25000,
    ).catch(() => null);
    fetchStubActive = false;
    await send("Fetch.disable");
    const observedAfter = await evaluate(SEARCH_STATE).catch(() => null);
    results.notes.remoteEmptyState.observedAfterStub = observedAfter;
    results.notes.remoteEmptyState.stubbedRequestsServed = fetchStubHits;
    const emptyOk = empty !== null;
    step(
      "zero-match response renders the empty state naming the query (zero-track response stubbed at the CDP Fetch boundary)",
      emptyOk,
      empty
        ? `emptyTitle=${JSON.stringify(empty.emptyTitle)} stubbedRequests=${fetchStubHits} liveProviderRows=${results.notes.remoteEmptyState.liveProviderResponse?.rows ?? "n/a"}`
        : `never settled; stubbedRequests=${fetchStubHits} fetchErrors=${JSON.stringify(results.notes.fetchErrors)} observed=${JSON.stringify(observedAfter && { rows: observedAfter.rows, loading: observedAfter.loading, emptyTitle: observedAfter.emptyTitle, errorTitle: observedAfter.errorTitle, notice: observedAfter.notice, inputValue: observedAfter.inputValue })}`,
    );
    if (emptyOk) {
      results.step7 = { emptyTitle: empty.emptyTitle, stubbedRequests: fetchStubHits };
      await shoot(1280, 900, "search-empty-1280.png", `empty state naming "${QUERY_NONSENSE}"`);
    }

    // =====================================================================
    // STEP 8 — offline local fallback (spec "Local library fallback")
    // =====================================================================
    const likedTitle = results.step5?.menuTitle ?? null;
    results.step8 = { likedTitle };
    const beforeOffline = await searchRequests();

    await send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    let onLine = await evaluate(`navigator.onLine`);
    for (let i = 0; i < 25 && onLine !== false; i++) {
      await delay(300);
      onLine = await evaluate(`navigator.onLine`);
    }
    results.notes.offlineEmulation = {
      command: "Network.emulateNetworkConditions {offline:true, latency:0, downloadThroughput:0, uploadThroughput:0}",
      navigatorOnLineAfterEmulation: onLine,
    };
    step(
      "CDP offline emulation is reflected by navigator.onLine",
      onLine === false,
      `navigator.onLine=${onLine}`,
    );

    if (likedTitle) {
      await clearInput();
      await typeText(likedTitle, 30);
      const offlineSurface = await waitFor(
        "offline local fallback surface",
        SEARCH_STATE,
        (s) => (s.notice !== null || s.offlineEmptyTitle !== null) && s.inputValue === likedTitle,
        20000,
      ).catch(() => null);
      const noticeOk = offlineSurface !== null && /Offline — showing matches from your library\./.test(offlineSurface.notice ?? "");
      const localMatch = offlineSurface !== null && offlineSurface.texts.some((t) => t.toLowerCase().includes(likedTitle.toLowerCase().slice(0, 25)));
      step(
        "offline notice renders with local matches for the liked track",
        noticeOk && localMatch,
        `notice=${JSON.stringify(offlineSurface?.notice ?? null)} ${offlineSurface ? rowsDetail(offlineSurface) : "no surface"}`,
      );

      const duringOffline = await searchRequests();
      const newRequests = duringOffline.slice(beforeOffline.length);
      step(
        "NO /api/search request issued while offline (fetch spy)",
        newRequests.length === 0,
        `newRequests=${JSON.stringify(newRequests)} totalBefore=${beforeOffline.length}`,
      );
      results.step8.requestsDuringOffline = newRequests;
      if (noticeOk && localMatch) {
        await shoot(1280, 900, "search-offline-fallback-1280.png", "offline local fallback for a liked track");
      }
    } else {
      step("offline notice renders with local matches for the liked track", false, "no liked track title captured");
      step("NO /api/search request issued while offline (fetch spy)", false, "no liked track title captured");
    }

    await send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    let backOnline = await evaluate(`navigator.onLine`);
    for (let i = 0; i < 25 && backOnline !== true; i++) {
      await delay(300);
      backOnline = await evaluate(`navigator.onLine`);
    }
    results.notes.offlineEmulation.navigatorOnLineAfterRestore = backOnline;
    await delay(1500);
    const afterOnlineRequests = await searchRequests();
    results.notes.offlineEmulation.requestsAfterReconnect = afterOnlineRequests.slice(
      (results.step8.requestsDuringOffline ?? []).length + beforeOffline.length,
    );
    step("network restored (navigator.onLine back to true)", backOnline === true, `navigator.onLine=${backOnline}`);

    // =====================================================================
    // STEP 9 — console hygiene + screenshot coverage
    // =====================================================================
    step(
      "zero console errors for the whole session",
      results.consoleErrors.length === 0,
      results.consoleErrors.join(" | ") || "none",
    );
    step(
      "at least four screenshots captured",
      results.screenshots.length >= 4,
      `${results.screenshots.length}: ${results.screenshots.map((s) => s.file).join(", ")}`,
    );

    results.pass = results.steps.every((s) => s.ok);
  } catch (error) {
    results.error = String(error?.stack ?? error);
    console.error(`EVIDENCE RUN FAILED: ${results.error}`);
  } finally {
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
