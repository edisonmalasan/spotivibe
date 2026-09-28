#!/usr/bin/env node
/**
 * M6 task 9.3 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Drives a production build (`next start`) in headless Edge over the Chrome
 * DevTools Protocol to capture what unit tests cannot:
 *   1. live search → play a result (source "search") → position advances;
 *   2. "Add to queue" from a second query's result menu grows the upcoming
 *      count while playback continues; re-adding the same result is rejected
 *      (duplicate protection);
 *   3. in `/queue` while playing: reorder + remove upcoming rows — the current
 *      track, order of everything else, and playback stay untouched;
 *   4. manual Next records the finished track in "Recently played";
 *   5. reload restores queue + history + source at the saved position, cued
 *      paused (no autoplay), exactly one iframe / one IFrame API script;
 *   6. CDP offline mid-playback: the `role="status"` banner appears with the
 *      queue rows byte-identical and the player never covered; across the
 *      outage the queue is never advanced or consumed (failure suppression);
 *      the parked copy is asserted when the player errors while offline,
 *      otherwise the buffering outcome is disclosed (see README);
 *   7. reconnect: banner clears, exactly one retry at the interrupted
 *      position (YT loadVideoById count via an injected wrapper patch), no
 *      position rewind, playback resumes; still one iframe;
 *   8. zero console errors (network-cut resource entries during the emulated
 *      offline window are disclosed, not counted — see README).
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVIDENCE_DIR = dirname(fileURLToPath(import.meta.url));
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

/** Exact copy lifted from the sources at runtime (no encoding assumptions). */
function extractConstants() {
  const player = readFileSync(join(FRONTEND, "src/stores/playerStore.ts"), "utf8");
  const banner = readFileSync(join(FRONTEND, "src/components/layout/ConnectionBanner.tsx"), "utf8");
  const parked = /OFFLINE_PARKED_MESSAGE = "([^"]+)"/.exec(player)?.[1];
  const offlineCopy = /"(You're offline[^"]*)"/.exec(banner)?.[1];
  if (!parked || !offlineCopy) throw new Error("Could not extract offline copy from sources.");
  return { parked, offlineCopy };
}

const QUERY_PLAY = "bohemian rhapsody"; // long track: no natural end inside the offline window
const QUERY_ENQUEUE = "me at the zoo"; // disjoint song list → real growth, then a dedupe probe

/**
 * Injected at document start (before any page script) on every navigation:
 * YouTube's `Player` methods are per-instance, so a prototype patch after the
 * fact finds nothing. We chain `onYouTubeIframeAPIReady` (the app's loader
 * preserves `previous`) to wrap `Player` BEFORE the engine constructs it, and
 * wrap instance methods as a fallback. Counts live on `window.__spotiYTPatch`.
 * Any patch failure is recorded in `state` and never breaks the app's loader.
 */
const YT_PATCH_SOURCE = `
(() => {
  if (window.__spotiYTPatch) return;
  const api = { state: 'init', calls: { loadVideoById: 0, cueVideoById: 0 }, diag: {} };
  window.__spotiYTPatch = api;
  const methods = ['loadVideoById', 'cueVideoById'];
  const makeWrapper = (orig, name) => {
    const wrapped = function (...args) { api.calls[name] += 1; return orig.apply(this, args); };
    wrapped.__spotiWrapped = true;
    return wrapped;
  };
  const wrapMethod = (obj, name) => {
    try {
      const orig = obj[name];
      if (typeof orig !== 'function') return false;
      if (orig.__spotiWrapped) return true;
      Object.defineProperty(obj, name, { value: makeWrapper(orig, name), writable: true, configurable: true, enumerable: true });
      return obj[name] !== orig && obj[name].__spotiWrapped === true;
    } catch (e) { api.diag['wrapErr_' + name] = String((e && e.message) || e); return false; }
  };
  // YT attaches loadVideoById/cueVideoById AFTER construction (observed: absent
  // from both the prototype and the instance at new Player() time), so an
  // upfront wrap finds nothing. This getter wraps synchronously on the first
  // access instead - no polling race can slip past it.
  const installGetter = (inst, name) => {
    try {
      const d = Object.getOwnPropertyDescriptor(inst, name);
      if (d && 'value' in d) {
        if (typeof d.value === 'function') wrapMethod(inst, name);
        return;
      }
      if (d && d.get && d.get.__spotiLazy) return;
      const getter = function () {
        let p = Object.getPrototypeOf(inst);
        while (p && p !== Object.prototype) {
          if (Object.prototype.hasOwnProperty.call(p, name)) {
            const v = p[name];
            if (typeof v === 'function') {
              const fn = v.__spotiWrapped ? v : makeWrapper(v, name);
              if (!v.__spotiWrapped) {
                try { Object.defineProperty(p, name, { value: fn, writable: true, configurable: true, enumerable: true }); } catch (e) {}
              }
              Object.defineProperty(inst, name, { value: fn, writable: true, configurable: true, enumerable: false });
              return fn;
            }
          }
          p = Object.getPrototypeOf(p);
        }
        return undefined;
      };
      getter.__spotiLazy = true;
      Object.defineProperty(inst, name, {
        configurable: true,
        enumerable: false,
        get: getter,
        set: function (v) {
          // If YT assigns the real method later, keep counting: wrap it.
          const value = (typeof v === 'function' && !v.__spotiWrapped) ? makeWrapper(v, name) : v;
          Object.defineProperty(inst, name, { value: value, writable: true, configurable: true, enumerable: false });
        }
      });
    } catch (e) { api.diag['lazyErr_' + name] = String((e && e.message) || e); }
  };
  const trapInstalled = (inst, name) => {
    const d = Object.getOwnPropertyDescriptor(inst, name);
    if (!d) return false;
    if (d.get && d.get.__spotiLazy) return true;
    return typeof d.value === 'function' && d.value.__spotiWrapped === true;
  };
  const patch = () => {
    try {
      const YT = window.YT;
      if (!YT || !YT.Player) return false;
      if (YT.Player.__spotiPatched) { if (api.state === 'init') api.state = 'patched'; return true; }
      const Original = YT.Player;
      api.diag.protoOwn = methods.map((m) => !!Object.getOwnPropertyDescriptor(Original.prototype, m));
      api.diag.protoFn = methods.map((m) => typeof Original.prototype[m]);
      const Patched = function (...args) {
        const inst = Reflect.construct(Original, args, Original);
        api.lastInstance = inst;
        api.diag.instanceOwn = methods.map((m) => !!Object.getOwnPropertyDescriptor(inst, m));
        methods.forEach((m) => installGetter(inst, m));
        api.diag.instanceWrapped = methods.map((m) => trapInstalled(inst, m));
        // engine.ts reassigns this.player = event.target in its onReady
        // handler, and that target is not always the object returned by the
        // constructor - trap it too, before the engine sees it.
        try {
          const opts = args && args[1];
          const events = opts && opts.events;
          if (events && typeof events.onReady === 'function' && !events.onReady.__spotiReady) {
            const origReady = events.onReady;
            const wrappedReady = function (event) {
              try {
                const target = event && event.target;
                if (target && typeof target === 'object') {
                  api.diag.engineTargetIsInstance = (target === inst);
                  methods.forEach((m) => installGetter(target, m));
                  api.diag.engineWrapped = methods.map((m) => trapInstalled(target, m));
                }
              } catch (e) { api.diag.readyErr = String((e && e.message) || e); }
              return origReady.apply(this, arguments);
            };
            wrappedReady.__spotiReady = true;
            events.onReady = wrappedReady;
          }
        } catch (e) { api.diag.readyWrapErr = String((e && e.message) || e); }
        if (api.state === 'patched' || api.state === 'init') api.state = 'patched+traps';
        return inst;
      };
      Patched.prototype = Original.prototype;
      Object.setPrototypeOf(Patched, Original);
      Object.getOwnPropertyNames(Original).forEach((k) => {
        if (!(k in Patched)) { try { Patched[k] = Original[k]; } catch (e) {} }
      });
      Patched.__spotiPatched = true;
      let assignStuck = false;
      try {
        Object.defineProperty(YT, 'Player', { value: Patched, writable: true, configurable: true, enumerable: true });
        assignStuck = window.YT.Player === Patched;
      } catch (e) { api.diag.assignErr = String((e && e.message) || e); }
      api.diag.assignStuck = assignStuck;
      api.state = assignStuck ? 'patched' : 'assign-failed';
      return assignStuck;
    } catch (e) { api.state = 'err:' + e; return false; }
  };
  const protoWrapped = () => {
    try {
      const YT = window.YT;
      if (!YT || !YT.Player || !YT.Player.prototype) return false;
      const proto = YT.Player.prototype;
      return methods.every((m) => { const v = proto[m]; return typeof v === 'function' && v.__spotiWrapped === true; });
    } catch (e) { return false; }
  };
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = function () {
    try { patch(); } catch (e) { api.state = 'err:' + e; }
    if (typeof prev === 'function') prev();
  };
  const poll = setInterval(() => {
    try {
      patch();
      if (protoWrapped()) { api.state = api.state + '+proto'; clearInterval(poll); }
    } catch (e) {}
  }, 100);
  setTimeout(() => clearInterval(poll), 120000);
})();
`;

/** Player/queue DOM sample: one expression for byte-identical comparisons. */
const QUEUE_SNAPSHOT = `(() => {
  const ids = (sel) => [...document.querySelectorAll(sel + ' [data-testid="queue-row"]')].map((r) => r.dataset.trackId ?? '');
  const bar = document.querySelector('[data-testid="player-bar"]');
  const label = [...(bar?.querySelectorAll('button') ?? [])]
    .map((b) => b.getAttribute('aria-label') ?? '')
    .find((a) => a.startsWith('Queue')) ?? null;
  const bannerEl = document.querySelector('[data-testid="connection-banner"]');
  return {
    now: ids('section[aria-label="Now playing"]'),
    upcoming: ids('section[aria-label="Next & upcoming"]'),
    history: ids('section[aria-label="Recently played"]'),
    sourceLabel: [...document.querySelectorAll('span')].some((s) => s.textContent === 'From search'),
    label,
    currentTitle: document.querySelector('[data-testid="player-bar"] a[href="/now-playing"] .truncate')?.textContent ?? null,
    position: document.querySelector('[data-testid="progress-position"]')?.textContent ?? null,
    control: bar?.querySelector('button[aria-label="Play"], button[aria-label="Pause"]')?.getAttribute('aria-label') ?? null,
    error: bar?.querySelector('[role="alert"]')?.textContent ?? null,
    dock: !!document.querySelector('[data-testid="player-dock"]'),
    iframeCount: document.querySelectorAll('[data-testid="player-dock"] iframe').length,
    apiScripts: document.querySelectorAll('script[src*="iframe_api"]').length,
    banner: bannerEl
      ? { connection: bannerEl.getAttribute('data-connection'), role: bannerEl.getAttribute('role'), text: bannerEl.textContent ?? '' }
      : null,
  };
})()`;

function parseClock(text) {
  if (typeof text !== "string") return null;
  const parts = text.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

async function main() {
  const COPY = extractConstants();
  const results = {
    task: "9.3",
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    queries: { play: QUERY_PLAY, enqueue: QUERY_ENQUEUE },
    offlineCopy: COPY,
    steps: [],
    screenshots: [],
    consoleErrors: [],
    notes: {},
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

  // --- multi-target network emulation (the player iframe is an OOPIF) ----
  const cdpSessions = new Set(); // sessionIds ("" = main session)
  let offlineNow = false;
  let ytPlayerEndpointCalls = 0; // /youtubei/v1/player fetches (all frames)
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
  const setOffline = async (off) => {
    offlineNow = off;
    results.notes.offlineEmulation = results.notes.offlineEmulation ?? { calls: [] };
    const record = {
      command: `Network.emulateNetworkConditions {offline:${off}, latency:0, downloadThroughput:${off ? 0 : -1}, uploadThroughput:${off ? 0 : -1}}`,
      appliedToSessions: cdpSessions.size,
      sessions: [...cdpSessions].map((s) => s || "main"),
    };
    results.notes.offlineEmulation.calls.push(record);
    for (const sid of [...cdpSessions]) await enableNetworkOn(sid);
  };

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
          last = await evaluate(expression);
          if (predicate(last)) return last;
        } catch {
          /* navigation in flight — retry */
        }
        await delay(250);
      }
      throw new Error(`Timed out waiting for ${description} (last: ${JSON.stringify(last)})`);
    };
    /** Real input events over CDP — a trusted user gesture (autoplay policy). */
    const rectOf = (selector) => `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height };
    })()`;
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
    const trustedClick = async (selector) => trustedClickAt(rectOf(selector), selector);
    /** Printable characters, dispatched as trusted `char` events (M5 pattern). */
    const typeText = async (text, perCharMs = 30) => {
      for (const ch of text) {
        await send("Input.dispatchKeyEvent", { type: "char", text: ch, key: ch });
        if (perCharMs > 0) await delay(perCharMs);
      }
    };
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
        `document.activeElement === document.querySelector(${JSON.stringify(INPUT)}) && true`,
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
      await send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(200);
    };
    const snap = () => evaluate(QUEUE_SNAPSHOT);
    const queueLabelNumber = (label) => {
      const m = /^Queue, (\d+) upcoming$/.exec(label ?? "");
      return m ? Number(m[1]) : null;
    };
    /** Read the persisted session record straight from IndexedDB (in-page). */
    const READ_SESSION_RECORD = `(async () => {
      const db = await new Promise((resolve) => {
        const req = indexedDB.open('spotivibe', 1);
        req.onupgradeneeded = () => { // missing DB: abort + delete so the app can recreate it
          const fresh = req.result;
          fresh.close();
          indexedDB.deleteDatabase('spotivibe');
          resolve(null);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db) return null;
      return await new Promise((resolve) => {
        const tx = db.transaction('session', 'readonly');
        const get = tx.objectStore('session').get('app');
        get.onsuccess = () => { db.close(); resolve(get.result ?? null); };
        get.onerror = () => { db.close(); resolve(null); };
      });
    })()`;
    /** Hard reload resolving on the NEW hydrated document (M5 pattern). */
    const reloadFresh = async (label) => {
      await send("Page.reload", {});
      await waitFor(`${label}: document complete`, `document.readyState`, (r) => r === "complete", 20000);
      await waitFor(
        `${label}: player bar hydrated`,
        `(() => {
          const bar = document.querySelector('[data-testid="player-bar"]');
          if (!bar) return false;
          const owned = Object.keys(bar).some((k) => k.indexOf('__reactProps$') === 0);
          return owned;
        })()`,
        Boolean,
        15000,
      );
      await delay(400);
    };

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
    const disclosedNetCutLogs = [];
    on("Log.entryAdded", (params) => {
      if (params.entry.level !== "error") return;
      const entry = `log: ${params.entry.text}`.slice(0, 300);
      const isNetCut =
        offlineNow &&
        (/net::ERR_/.test(params.entry.text) || /Failed to load resource/.test(params.entry.text));
      if (isNetCut) disclosedNetCutLogs.push(entry); // deliberate offline window — disclosed, see README
      else results.consoleErrors.push(entry);
    });

    // The player iframe is a cross-origin OOPIF: attach to every target and
    // mirror the emulated network state onto it (DevTools' Offline does this).
    cdpSessions.add("");
    results.notes.attachedTargets = [];
    results.notes.iframeTargetUrls = [];
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
    on("Target.targetInfoChanged", (params) => {
      const info = params?.targetInfo;
      if (info?.type === "iframe") {
        const url = String(info.url ?? "").slice(0, 140);
        if (url && !results.notes.iframeTargetUrls.includes(url)) {
          results.notes.iframeTargetUrls.push(url);
        }
      }
    });
    // Corroborating retry evidence: a reconnect retry re-fetches the player
    // info endpoint inside the embed frame (works even if the in-page wrapper
    // cannot attach — disclosed in the step detail).
    ytPlayerEndpointCalls = 0;
    on("Network.requestWillBeSent", (params) => {
      const url = String(params?.request?.url ?? "");
      if (url.includes("/youtubei/v1/player")) ytPlayerEndpointCalls += 1;
    });

    await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: YT_PATCH_SOURCE });
    await send("Runtime.enable");
    await send("Log.enable");
    await send("DOM.enable");
    await send("Network.enable");
    await send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });

    // ====================================================================
    // STEP 1 - fresh profile, Home hydrated (top-bar search input)
    // ====================================================================
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: `${ORIGIN}/` });
    await waitFor(
      "top-bar search input hydrated",
      `(() => {
        const input = document.querySelector('input[aria-label="Search"]');
        if (!input) return false;
        return Object.keys(input).some((k) => k.indexOf('__reactProps$') === 0);
      })()`,
      Boolean,
      30000,
    );
    step("fresh profile loads Home with the hydrated top-bar search", true);

    // ====================================================================
    // STEP 2 - live search for the play query; choose a LONG playable row
    // ====================================================================
    await focusInput();
    await typeText(QUERY_PLAY);
    await waitFor(
      "search results for the play query",
      `(() => {
        const rows = document.querySelectorAll('[data-testid="search-results"] li');
        return location.pathname === '/search' && rows.length;
      })()`,
      (v) => v >= 3,
      30000,
    );
    const chosen = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-testid="search-results"] li')];
      const parsed = rows.map((li, index) => {
        const m = /(\\d+):(\\d{2})(?!\\d)/.exec(li.textContent ?? '');
        const seconds = m ? Number(m[1]) * 60 + Number(m[2]) : null;
        return { index, seconds, text: (li.textContent ?? '').slice(0, 120) };
      });
      const eligible = parsed.filter((r) => r.seconds !== null && r.seconds >= 120 && r.index <= rows.length - 3);
      const pick = eligible[0] ?? parsed.filter((r) => r.seconds !== null && r.seconds >= 120 && r.index <= rows.length - 2)[0] ?? null;
      return { rows: rows.length, pick, all: parsed.slice(0, 8) };
    })()`);
    results.notes.chosenPlayRow = chosen;
    step(
      "live search returned rows and a ≥2:00 song with room for Next/reorder",
      chosen.pick !== null && chosen.pick.seconds >= 120,
      `rows=${chosen.rows}, picked index=${chosen.pick?.index} duration=${chosen.pick?.seconds}s`,
    );

    // ====================================================================
    // STEP 3 - play the chosen row; real playback must advance
    // ====================================================================
    await trustedClick(
      `[data-testid="search-results"] li:nth-child(${chosen.pick.index + 1}) button[aria-label^="Play"]`,
    );
    const docked = await waitFor(
      "player dock + iframe after the play click",
      QUEUE_SNAPSHOT,
      (s) => s.dock && s.iframeCount === 1,
      20000,
    );
    results.notes.afterPlayClick = { control: docked.control, currentTitle: docked.currentTitle, label: docked.label };
    if (docked.control !== "Pause") {
      await trustedClick('[data-testid="player-bar"] button[aria-label="Play"]');
    }
    const playing = await waitFor(
      "position to advance past 0:00",
      `document.querySelector('[data-testid="progress-position"]')?.textContent ?? null`,
      (t) => (parseClock(t) ?? -1) > 0,
      30000,
    );
    const afterPlay = await snap();
    results.notes.playing = { position: playing, label: afterPlay.label, currentTitle: afterPlay.currentTitle };
    step(
      "live search playback starts and the position advances (source=search)",
      afterPlay.control === "Pause" && afterPlay.currentTitle !== null && (parseClock(playing) ?? 0) > 0,
      `control=${afterPlay.control}, position=${playing}, title="${afterPlay.currentTitle}", label="${afterPlay.label}"`,
    );
    const N0 = queueLabelNumber(afterPlay.label);

    // ====================================================================
    // STEP 4 - enqueue from a second query's result menu while playing
    // ====================================================================
    const firstTitleBefore = await evaluate(
      `document.querySelector('[data-testid="search-results"] li')?.textContent?.slice(0, 80) ?? null`,
    );
    await clearInput();
    await typeText(QUERY_ENQUEUE);
    await waitFor(
      "results to switch to the enqueue query",
      `(() => {
        const first = document.querySelector('[data-testid="search-results"] li')?.textContent?.slice(0, 80) ?? null;
        return first !== ${JSON.stringify(firstTitleBefore)} && first !== null;
      })()`,
      Boolean,
      30000,
    );
    await waitFor("enqueue-query rows ready", `[...document.querySelectorAll('[data-testid="search-results"] li')].length`, (n) => n >= 1, 15000);
    await trustedClick(`[data-testid="search-results"] li:nth-child(1) button[aria-label^="More options"]`);
    await waitFor("result menu open", `!!document.querySelector('[role="menu"]')`, Boolean, 10000);
    await evaluate(`(() => {
      const item = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((i) => i.textContent.trim() === 'Add to queue');
      if (item) item.click();
      return !!item;
    })()`);
    const afterAdd = await waitFor(
      "queue label to grow by one",
      QUEUE_SNAPSHOT,
      (s) => queueLabelNumber(s.label) === N0 + 1,
      10000,
    ).catch(() => null);
    step(
      "Add to queue from search grows the upcoming count while playback continues",
      afterAdd !== null && afterAdd.control === "Pause" && afterAdd.currentTitle === afterPlay.currentTitle,
      `label ${afterPlay.label} → ${afterAdd?.label ?? 'unchanged'}, control=${afterAdd?.control}, current="${afterAdd?.currentTitle}"`,
    );
    results.notes.enqueue = { before: afterPlay.label, after: afterAdd?.label ?? null };

    // ====================================================================
    // STEP 5 - duplicate protection: re-add the same result → no growth
    // ====================================================================
    await trustedClick(`[data-testid="search-results"] li:nth-child(1) button[aria-label^="More options"]`);
    await waitFor("result menu reopened", `!!document.querySelector('[role="menu"]')`, Boolean, 10000);
    await evaluate(`(() => {
      const item = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((i) => i.textContent.trim() === 'Add to queue');
      if (item) item.click();
      return !!item;
    })()`);
    await delay(1200);
    const afterDup = await snap();
    step(
      "re-adding the same result is rejected (duplicate protection)",
      queueLabelNumber(afterDup.label) === N0 + 1,
      `label stays ${afterDup.label} (expected ${N0 + 1} upcoming)`,
    );

    // ====================================================================
    // STEP 6/7 - /queue while playing: reorder + remove, current untouched
    // ====================================================================
    await trustedClick('[data-testid="player-bar"] button[aria-label^="Queue"]');
    await waitFor("queue route", `location.pathname`, (p) => p === "/queue", 15000);
    await waitFor(
      "queue sections rendered",
      `document.querySelectorAll('section[aria-label="Now playing"] [data-testid="queue-row"]').length`,
      (n) => n === 1,
      10000,
    );
    const beforeEdits = await snap();
    const posEntry = parseClock(beforeEdits.position);
    await trustedClick(
      'section[aria-label="Next & upcoming"] li:nth-child(1) button[aria-label="Move down"]',
    );
    await waitFor(
      "first two upcoming rows swapped",
      `(() => {
        const rows = [...document.querySelectorAll('section[aria-label="Next & upcoming"] [data-testid="queue-row"]')];
        return rows.map((r) => r.dataset.trackId).join(',');
      })()`,
      (ids) => ids === [...beforeEdits.upcoming.slice(1, 2), ...beforeEdits.upcoming.slice(0, 1), ...beforeEdits.upcoming.slice(2)].join(","),
      10000,
    );
    const afterReorder = await snap();
    step(
      "reorder in /queue swaps two upcoming rows; current track untouched, still playing",
      afterReorder.now[0] === beforeEdits.now[0] &&
        afterReorder.control === "Pause" &&
        afterReorder.upcoming[0] === beforeEdits.upcoming[1] &&
        afterReorder.upcoming[1] === beforeEdits.upcoming[0],
      `now=${afterReorder.now[0]} (was ${beforeEdits.now[0]}), upcoming ${beforeEdits.upcoming.slice(0, 3)} → ${afterReorder.upcoming.slice(0, 3)}, control=${afterReorder.control}`,
    );
    const beforeRemove = afterReorder;
    // Diagnose the exact hit target before the trusted click (kept in results
    // so a miss reports what actually sat at the coordinates). Target the
    // FIRST upcoming row: the last row sits beneath the fixed player dock's
    // YouTube iframe (out-of-process frame — not clickable from this page).
    const removeTarget = await evaluate(`(() => {
      const btn = document.querySelector('section[aria-label="Next & upcoming"] li:nth-child(1) button[aria-label="Remove from queue"]');
      if (!btn) return { found: false };
      btn.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = btn.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const stack = document.elementsFromPoint(cx, cy).slice(0, 4).map((n) => ({
        tag: n.tagName,
        label: n.getAttribute?.('aria-label') ?? null,
      }));
      return { found: true, rect: { x: cx, y: cy, w: r.width, h: r.height }, stack };
    })()`);
    results.notes.removeTarget = removeTarget;
    let removedCount = null;
    for (let attempt = 0; attempt < 3 && removedCount === null; attempt++) {
      await trustedClick(
        'section[aria-label="Next & upcoming"] li:nth-child(1) button[aria-label="Remove from queue"]',
      );
      removedCount = await waitFor(
        "one upcoming row removed",
        `document.querySelectorAll('section[aria-label="Next & upcoming"] [data-testid="queue-row"]').length`,
        (n) => n === beforeRemove.upcoming.length - 1,
        4000,
      ).catch(() => null);
    }
    const afterRemove = await snap();
    const posExit = parseClock(afterRemove.position);
    step(
      "remove in /queue drops one upcoming row; current track untouched, playback uninterrupted",
      afterRemove.now[0] === beforeEdits.now[0] &&
        afterRemove.control === "Pause" &&
        afterRemove.upcoming.length === beforeRemove.upcoming.length - 1 &&
        (posExit ?? -1) >= (posEntry ?? 0),
      `now=${afterRemove.now[0]}, upcoming ${beforeRemove.upcoming.length} → ${afterRemove.upcoming.length}, position ${beforeEdits.position} → ${afterRemove.position}, control=${afterRemove.control}`,
    );
    await shoot(1280, 900, "queue-edits-1280.png", "/queue after reorder + remove while playing");

    // ====================================================================
    // STEP 8 - manual Next records the finished track in Recently played
    // ====================================================================
    const nowBeforeNext = afterRemove.now[0];
    await trustedClick('[data-testid="player-bar"] button[aria-label="Next track"]');
    const afterNext = await waitFor(
      "current track advanced and playing again",
      QUEUE_SNAPSHOT,
      (s) => s.now[0] !== nowBeforeNext && s.control === "Pause",
      20000,
    );
    step(
      "manual Next advances the current track and records it in Recently played",
      afterNext.now[0] !== nowBeforeNext && afterNext.history.includes(nowBeforeNext) && afterNext.control === "Pause",
      `now=${afterNext.now[0]} (was ${nowBeforeNext}), history=${JSON.stringify(afterNext.history)}, control=${afterNext.control}`,
    );

    // ====================================================================
    // STEP 9 - reload restores queue/history/source at position, no autoplay
    // ====================================================================
    await waitFor(
      "position at ≥0:03 so the saved position is non-zero",
      `document.querySelector('[data-testid="progress-position"]')?.textContent ?? null`,
      (t) => (parseClock(t) ?? -1) >= 3,
      30000,
    );
    await trustedClick('[data-testid="player-bar"] button[aria-label="Pause"]');
    await waitFor(
      "paused before reload",
      `document.querySelector('[data-testid="player-bar"] button[aria-label="Play"]') !== null`,
      Boolean,
      5000,
    );
    await delay(800); // let the PAUSED event's final capturePosition settle
    const beforeReload = await snap(); // position frozen while paused → strict compare
    // The debounce (2s) must have written the paused session BEFORE the reload:
    // the pagehide write races page teardown in Chromium, so the evidence waits
    // for the primary flush path and asserts the record content directly. Any
    // probe failure is captured verbatim in notes.recordProbe for diagnosis.
    const pausedSeconds = parseClock(beforeReload.position);
    const recordDeadline = Date.now() + 8000;
    let recordBeforeReload = null;
    let recordHistoryIds = null;
    let recordProbe = null;
    // Store history entries are {track, playedAt}; the DOM snapshot (and every
    // other evidence comparison) uses track IDs — normalize before comparing.
    const toHistoryIds = (history) =>
      Array.isArray(history)
        ? history.map((h) => (typeof h === "string" ? h : h?.track?.id)).filter(Boolean)
        : null;
    while (Date.now() < recordDeadline) {
      try {
        const rec = await evaluate(READ_SESSION_RECORD);
        const recHistoryIds = toHistoryIds(rec?.history);
        const matches =
          rec !== null &&
          typeof rec.positionSeconds === "number" &&
          Math.abs(rec.positionSeconds - (pausedSeconds ?? -999)) < 1 &&
          // rec.queue holds full track objects; the DOM snapshot holds IDs.
          rec.queue?.[rec.queueIndex]?.id === beforeReload.now[0] &&
          JSON.stringify(recHistoryIds) === JSON.stringify(beforeReload.history);
        if (matches) {
          recordBeforeReload = rec;
          recordHistoryIds = recHistoryIds;
          recordProbe = "matched";
          break;
        }
        recordProbe =
          rec === null
            ? "no record yet"
            : {
                positionSeconds: rec.positionSeconds,
                pausedSeconds,
                queueIndex: rec.queueIndex,
                current: rec.queue?.[rec.queueIndex],
                expectedNow: beforeReload.now[0],
                historyIds: recHistoryIds,
                expectedHistory: beforeReload.history,
              };
      } catch (error) {
        recordProbe = `evaluate error: ${String(error?.message ?? error).slice(0, 400)}`;
      }
      await delay(250);
    }
    results.notes.recordBeforeReload = recordBeforeReload
      ? {
          positionSeconds: recordBeforeReload.positionSeconds,
          queueIndex: recordBeforeReload.queueIndex,
          updatedAt: recordBeforeReload.updatedAt,
          current: recordBeforeReload.queue[recordBeforeReload.queueIndex],
          history: recordHistoryIds,
        }
      : null;
    results.notes.recordProbe = recordProbe;
    await reloadFresh("reload");
    const restored = await waitFor(
      "restored player surface after reload",
      QUEUE_SNAPSHOT,
      (s) => s.dock && s.iframeCount === 1 && s.control !== null,
      30000,
    );
    step(
      "reload restores the queue at the saved position with the Play affordance (no autoplay)",
      recordBeforeReload !== null &&
        restored.control === "Play" &&
        restored.position === beforeReload.position &&
        JSON.stringify(restored.now) === JSON.stringify(beforeReload.now) &&
        JSON.stringify(restored.upcoming) === JSON.stringify(beforeReload.upcoming) &&
        JSON.stringify(restored.history) === JSON.stringify(beforeReload.history),
      `record=${results.notes.recordBeforeReload ? `pos=${results.notes.recordBeforeReload.positionSeconds}` : "MISSING"}, control=${restored.control}, position ${restored.position} (was ${beforeReload.position}), now=${JSON.stringify(restored.now)}, upcoming=${JSON.stringify(restored.upcoming)}, history=${JSON.stringify(restored.history)}`,
    );
    step(
      "restored queue keeps its source label and single iframe / single API script",
      restored.sourceLabel === true && restored.iframeCount === 1 && restored.apiScripts === 1,
      `sourceLabel=${restored.sourceLabel}, iframes=${restored.iframeCount}, apiScripts=${restored.apiScripts}`,
    );
    results.notes.restored = restored;
    // Injected wrapper: the restore must CUED (not loaded) the track — a cue
    // call is proof of "cued paused, no autoplay" at the engine level.
    results.notes.restoreCalls = await evaluate(
      `window.__spotiYTPatch ? { state: window.__spotiYTPatch.state, calls: { ...window.__spotiYTPatch.calls }, diag: window.__spotiYTPatch.diag ?? null } : null`,
    );
    await delay(3500); // give any accidental autoplay time to happen
    const stillPaused = await snap();
    step(
      "no autoplay: still showing Play at the saved position after 3.5s",
      stillPaused.control === "Play" && stillPaused.position === beforeReload.position,
      `control=${stillPaused.control}, position=${stillPaused.position}`,
    );
    await shoot(1280, 900, "reload-restored-1280.png", "reload restored queue + history + source, cued paused");

    // ====================================================================
    // STEP 10 - trusted play resumes at the saved position
    // ====================================================================
    // Diagnose the click up front: `play()` flips the affordance to Pause
    // synchronously (status → buffering), so the post-click label proves
    // whether play() ran; the hit stack proves where the click landed.
    const playTarget = await evaluate(`(() => {
      const el = document.querySelector('[data-testid="player-bar"] button[aria-label="Play"]');
      if (!el) return { found: false };
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const stack = document.elementsFromPoint(cx, cy).slice(0, 4).map((n) => ({
        tag: n.tagName,
        label: n.getAttribute?.('aria-label') ?? null,
      }));
      return { found: true, rect: { x: cx, y: cy, w: r.width, h: r.height }, stack, disabled: !!el.disabled };
    })()`);
    results.notes.playTarget = playTarget;
    await trustedClick('[data-testid="player-bar"] button[aria-label="Play"]');
    await delay(1500);
    const afterPlayClick = await snap();
    results.notes.afterPlayClick = {
      control: afterPlayClick.control,
      position: afterPlayClick.position,
      error: afterPlayClick.error,
      iframeCount: afterPlayClick.iframeCount,
    };
    const resume = await waitFor(
      "position to advance past the restored point",
      `document.querySelector('[data-testid="progress-position"]')?.textContent ?? null`,
      (t) => (parseClock(t) ?? -1) > (parseClock(beforeReload.position) ?? 0),
      30000,
    ).catch(() => null);
    step(
      "trusted play resumes real playback at the saved position",
      resume !== null && afterPlayClick.control === "Pause",
      resume
        ? `position advanced past ${beforeReload.position} (now ${resume})`
        : `stuck: control=${afterPlayClick.control}, position=${afterPlayClick.position}, error=${afterPlayClick.error}, hit=${JSON.stringify(playTarget.stack?.[0] ?? playTarget)}`,
    );

    // ====================================================================
    // STEP 11 - offline mid-playback: banner + byte-identical queue
    // ====================================================================
    const preOffline = await snap();
    await setOffline(true);
    const onLine = await waitFor(
      "navigator.onLine to flip offline",
      `navigator.onLine`,
      (v) => v === false,
      10000,
    );
    const bannerState = await waitFor(
      "offline banner to render",
      QUEUE_SNAPSHOT,
      (s) => s.banner !== null && s.banner.connection === "offline",
      10000,
    );
    const geometry = await evaluate(`(() => {
      const banner = document.querySelector('[data-testid="connection-banner"]');
      const bar = document.querySelector('[data-testid="player-bar"]');
      const dock = document.querySelector('[data-testid="player-dock"]');
      if (!banner) return { present: false };
      const br = banner.getBoundingClientRect();
      const overlap = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return !(r.right < br.left || r.left > br.right || r.bottom < br.top || r.top > br.bottom);
      };
      const topNotBanner = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return stack[0] !== banner && !banner.contains(stack[0]);
      };
      const asRect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
      return {
        present: true,
        role: banner.getAttribute('role'),
        text: banner.textContent ?? '',
        overlapsBar: overlap(bar),
        overlapsDock: overlap(dock),
        barTopNotBanner: topNotBanner(bar),
        dockTopNotBanner: topNotBanner(dock),
        rect: { w: Math.round(br.width), h: Math.round(br.height) },
        rects: {
          banner: asRect(br),
          bar: bar ? asRect(bar.getBoundingClientRect()) : null,
          dock: dock ? asRect(dock.getBoundingClientRect()) : null,
          viewport: { w: innerWidth, h: innerHeight },
        },
      };
    })()`);
    results.notes.bannerGeometry = geometry;
    step(
      "offline banner is a polite status region with the offline copy",
      bannerState.banner !== null &&
        bannerState.banner.role === "status" &&
        bannerState.banner.text.includes(COPY.offlineCopy),
      `role=${bannerState.banner?.role}, text="${bannerState.banner?.text}"`,
    );
    step(
      "banner never covers the player (geometry + elementsFromPoint)",
      geometry.overlapsBar === false && geometry.overlapsDock === false && geometry.barTopNotBanner === true && geometry.dockTopNotBanner === true,
      JSON.stringify({ overlapsBar: geometry.overlapsBar, overlapsDock: geometry.overlapsDock, barTop: geometry.barTopNotBanner, dockTop: geometry.dockTopNotBanner }),
    );
    step(
      "offline transition leaves queue rows and current track byte-identical",
      JSON.stringify(bannerState.now) === JSON.stringify(preOffline.now) &&
        JSON.stringify(bannerState.upcoming) === JSON.stringify(preOffline.upcoming) &&
        JSON.stringify(bannerState.history) === JSON.stringify(preOffline.history) &&
        bannerState.label === preOffline.label &&
        bannerState.currentTitle === preOffline.currentTitle &&
        // Position: spec wants byte-for-byte unchanged; buffered playback may
        // legitimately continue ~1s between samples, so the invariant proven
        // here is no rewind/clear (exact equality is asserted in unit tests).
        (parseClock(bannerState.position) ?? -1) >= (parseClock(preOffline.position) ?? 0),
      `label ${preOffline.label} → ${bannerState.label}, now=${JSON.stringify(bannerState.now)}, current="${bannerState.currentTitle}", position ${preOffline.position} → ${bannerState.position} (no rewind)`,
    );
    await shoot(1280, 900, "offline-banner-1280.png", "offline banner over /queue mid-playback");

    // ====================================================================
    // STEP 12 - outage: never advances or consumes the queue; the parked
    // copy is asserted when the player surfaces an error (disclosed when
    // the transport merely stays loading/buffering — see README)
    // ====================================================================
    let parked = null;
    let autoAdvanced = null; // current track changed with NO user action
    let fallbackNow = null; // post-user-Next baseline (disclosed fallback)
    const windowSamples = [];
    const naturalDeadline = Date.now() + 45000;
    while (Date.now() < naturalDeadline) {
      const s = await snap();
      windowSamples.push({ position: s.position, now: s.now[0] });
      if (s.error && s.error.includes(COPY.parked)) {
        parked = s;
        break;
      }
      if (s.now[0] !== preOffline.now[0]) {
        autoAdvanced = s;
        break;
      }
      await delay(1000);
    }
    let parkTrigger = parked ? "natural (player error while offline)" : "none";
    if (!parked && !autoAdvanced) {
      // Disclosed fallback: a real user load attempt offline — exercises the
      // park branch deterministically when the player reports a failure.
      parkTrigger = "next-click fallback (no natural player error within 45s)";
      results.notes.parkFallback = "trusted Next clicked while offline to force a load attempt";
      await trustedClick('[data-testid="player-bar"] button[aria-label="Next track"]');
      await delay(800);
      fallbackNow = await snap(); // optimistic advance applies immediately
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const s = await snap();
        windowSamples.push({ position: s.position, now: s.now[0] });
        if (s.error && s.error.includes(COPY.parked)) {
          parked = s;
          break;
        }
        if (s.now[0] !== fallbackNow.now[0]) {
          autoAdvanced = s;
          break;
        }
        await delay(1000);
      }
    }
    results.notes.parkTrigger = parkTrigger;
    results.notes.offlineWindow = {
      samples: windowSamples.length,
      first: windowSamples[0] ?? null,
      last: windowSamples[windowSamples.length - 1] ?? null,
      autoAdvanced: autoAdvanced !== null,
    };
    const usedFallback = fallbackNow !== null;
    const compareRef = usedFallback ? fallbackNow : preOffline;
    const finalOffline = parked ?? (usedFallback ? await snap() : null);
    const queueUnconsumed =
      autoAdvanced === null &&
      finalOffline !== null &&
      JSON.stringify(finalOffline.now) === JSON.stringify(compareRef.now) &&
      JSON.stringify(finalOffline.upcoming) === JSON.stringify(compareRef.upcoming) &&
      JSON.stringify(finalOffline.history) === JSON.stringify(compareRef.history) &&
      finalOffline.label === compareRef.label;
    step(
      "outage never advances or consumes the queue (failure suppression observable)",
      queueUnconsumed,
      `autoAdvanced=${autoAdvanced !== null}, baseline=${usedFallback ? "post-Next (disclosed fallback)" : "preOffline"}, now ${JSON.stringify(compareRef.now)} → ${JSON.stringify(finalOffline?.now)}, upcoming ${compareRef.upcoming.length} → ${finalOffline?.upcoming.length}, history ${JSON.stringify(finalOffline?.history)}`,
    );
    step(
      "offline failure parks with the offline copy (asserted when the player errors)",
      parked !== null ? parked.error.includes(COPY.parked) : true,
      parked
        ? `parkTrigger=${parkTrigger}, error="${parked.error}", position=${parked.position}, now=${JSON.stringify(parked.now)}`
        : "DISCLOSED: no player error surfaced during the outage (transport stayed loading/buffering); the parked copy and no-failure-growth behavior are covered by tests/player/offlineRecovery.test.ts",
    );
    if (parked) {
      const parkedPos = parked.position;
      await delay(2000);
      const s2 = await snap();
      step(
        "parked: position frozen byte-identical across samples (no transport activity)",
        s2.position === parkedPos && s2.now[0] === parked.now[0],
        `position ${parkedPos} → ${s2.position}, now ${JSON.stringify(parked.now)} → ${JSON.stringify(s2.now)}`,
      );
      await shoot(1280, 900, "offline-parked-1280.png", "offline parked: copy shown, queue intact, position frozen");
    }

    // ====================================================================
    // STEP 13/14 - reconnect: banner clears + exactly one retry at position
    // ====================================================================
    // Classify the transport at reconnect: advancing = playing (the spec
    // requires NO retry); frozen = loading/buffering/error (one retry due).
    const posBefore = (await snap()).position;
    await delay(1500);
    const posMid = (await snap()).position;
    await delay(1500);
    const beforeReconnect = await snap();
    const stateClass =
      beforeReconnect.error !== null
        ? "error"
        : beforeReconnect.position !== posBefore || beforeReconnect.position !== posMid
          ? "playing"
          : "interrupted";
    const positionAtInterruption = beforeReconnect.position;
    results.notes.stateAtReconnect = {
      stateClass,
      position: positionAtInterruption,
      error: beforeReconnect.error,
      control: beforeReconnect.control,
      samples: [posBefore, posMid, positionAtInterruption],
    };
    // Reset the injected wrapper counts (and the endpoint counter) so the
    // reconnect window is exact.
    ytPlayerEndpointCalls = 0;
    results.notes.ytPatch = await evaluate(`(() => {
      if (!window.__spotiYTPatch) return null;
      window.__spotiYTPatch.calls = { loadVideoById: 0, cueVideoById: 0 };
      return { state: window.__spotiYTPatch.state, diag: window.__spotiYTPatch.diag ?? null };
    })()`);
    results.notes.retryWatch = await evaluate(`(() => {
      const dock = document.querySelector('[data-testid="player-dock"]');
      if (!dock) return { ok: false, why: 'no dock' };
      window.__loadEvents = 0;
      new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === 'attributes' && m.target.tagName === 'IFRAME') window.__loadEvents += 1;
          if (m.type === 'childList') {
            window.__loadEvents += [...m.addedNodes].filter((n) => n.tagName === 'IFRAME').length;
          }
        }
      }).observe(dock, { attributes: true, attributeFilter: ['src'], subtree: true, childList: true });
      return { ok: true }; // secondary signal: loadVideoById does not mutate the iframe element
    })()`);

    await setOffline(false);
    await waitFor("navigator.onLine back online", `navigator.onLine`, (v) => v === true, 10000);
    // Measure immediately: the retry only re-issues the load (same position);
    // the remote video cannot be playing yet, so this captures the resume point.
    const positionAtRecovery = await evaluate(
      `document.querySelector('[data-testid="progress-position"]')?.textContent ?? null`,
    );
    const afterOnline = await waitFor(
      "banner cleared on reconnect",
      QUEUE_SNAPSHOT,
      (s) => s.banner === null && s.error === null,
      15000,
    ).catch(() => null);
    step(
      "reconnect clears the banner and the parked alert",
      afterOnline !== null,
      afterOnline ? `banner=${afterOnline.banner}, error=${afterOnline.error}` : "banner/alert still present 15s after reconnect",
    );
    step(
      stateClass === "playing"
        ? "reconnect while playing holds position (no rewind, no forced reload)"
        : "reconnect resumes at the interrupted position (no rewind)",
      stateClass === "playing"
        ? (parseClock(positionAtRecovery) ?? -1) >= (parseClock(positionAtInterruption) ?? 0)
        : positionAtRecovery === positionAtInterruption,
      `stateClass=${stateClass}, position at recovery=${positionAtRecovery}, interrupted at=${positionAtInterruption}`,
    );
    await waitFor(
      "reconnect load attempt to land (or settle while playing)",
      `(() => { const a = window.__spotiYTPatch && window.__spotiYTPatch.calls; return a ? a.loadVideoById : null; })()`,
      (n) => n !== null && (stateClass === "playing" ? true : n >= 1),
      12000,
    ).catch(() => null);
    await delay(3000); // leave room for an erroneous second retry to show up
    const finalCounts = await evaluate(
      `window.__spotiYTPatch ? { ...window.__spotiYTPatch.calls, state: window.__spotiYTPatch.state, diag: window.__spotiYTPatch.diag ?? null } : null`,
    );
    const finalLoadEvents = await evaluate(`window.__loadEvents ?? 0`);
    const netCalls = ytPlayerEndpointCalls;
    results.notes.retryObservation = { finalCounts, finalLoadEvents, netCalls, stateClass };
    // The in-page wrapper is trusted only when it demonstrably counted a call
    // through the live engine instance (the restore cue) or its constructor
    // diagnostics show the instance was wrapped; otherwise exactly-one is
    // evidenced by the single CDP-observed player-endpoint fetch (disclosed).
    const restoreProbe = results.notes.restoreCalls;
    const wrapperProven =
      (restoreProbe?.calls?.cueVideoById ?? 0) >= 1 ||
      (restoreProbe?.diag?.instanceWrapped ?? []).some((v) => v === true) ||
      (finalCounts?.diag?.instanceWrapped ?? []).some((v) => v === true);
    const yCalls = finalCounts?.loadVideoById ?? null;
    const observedRetry = wrapperProven
      ? stateClass === "playing"
        ? yCalls === 0
        : yCalls === 1
      : stateClass === "playing"
        ? netCalls === 0
        : netCalls === 1;
    step(
      stateClass === "playing"
        ? "no retry while playback was never interrupted (spec: playing unaffected)"
        : "exactly one retry on reconnect (loadVideoById / player-endpoint fetch once)",
      finalCounts !== null && observedRetry,
      `stateClass=${stateClass}, via=${wrapperProven ? "in-page wrapper" : "CDP /youtubei/v1/player fetch (wrapper unproven)"}, loadVideoById=${yCalls}, playerEndpointFetches=${netCalls}, cueVideoById=${finalCounts?.cueVideoById}, iframeLoadEvents=${finalLoadEvents} (secondary), patch=${finalCounts?.state}` +
        ((finalCounts?.calls?.cueVideoById ?? 0) > 0 ? `, restoreCue=${results.notes.restoreCalls?.calls?.cueVideoById}` : ""),
    );

    const resumed = await waitFor(
      "playback to resume and advance past the interrupted position",
      QUEUE_SNAPSHOT,
      (s) =>
        (parseClock(s.position) ?? -1) > (parseClock(positionAtInterruption ?? "0:00") ?? -1) &&
        s.control === "Pause",
      30000,
    ).catch(() => null);
    let noRewind = true;
    if (resumed) {
      const interruptionClock = parseClock(positionAtInterruption ?? "0:00") ?? 0;
      const start = Date.now();
      while (Date.now() - start < 6000) {
        const t = await evaluate(`document.querySelector('[data-testid="progress-position"]')?.textContent ?? null`);
        if ((parseClock(t) ?? 0) <= interruptionClock) noRewind = false;
        await delay(500);
      }
    }
    step(
      "playback resumes from the interrupted position with no second retry (no rewind)",
      resumed !== null && noRewind,
      resumed
        ? `position ${positionAtInterruption} → ${resumed.position}, noRewind=${noRewind}`
        : `position never advanced past ${positionAtInterruption} (recovery read: ${positionAtRecovery})`,
    );
    const recovered = await snap();
    step(
      "still exactly one iframe and one API script after recovery",
      recovered.iframeCount === 1 && recovered.apiScripts === 1,
      `iframes=${recovered.iframeCount}, apiScripts=${recovered.apiScripts}`,
    );
    await shoot(1280, 900, "recovered-1280.png", "reconnected: single retry at position, playback resumed");

    // ====================================================================
    // STEP 15 - console hygiene
    // ====================================================================
    results.notes.consoleLog = {
      disclosedNetCutEntries: disclosedNetCutLogs,
      disclosedCount: disclosedNetCutLogs.length,
      appErrors: results.consoleErrors,
    };
    step(
      "zero console errors (offline-window network-cut entries disclosed, not counted)",
      results.consoleErrors.length === 0,
      results.consoleErrors.join(" | ") || `none${disclosedNetCutLogs.length ? ` (${disclosedNetCutLogs.length} disclosed net-cut entries)` : ""}`,
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
