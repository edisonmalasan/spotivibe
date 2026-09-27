#!/usr/bin/env node
/**
 * M4 task 6.3 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Drives a production build (`next start`) in headless Edge over the Chrome
 * DevTools Protocol to capture what unit tests cannot:
 *   1. import a backup fixture whose session contains a real YouTube track;
 *   2. reload → the session restores cued and paused (no autoplay), with the
 *      docked player surface visible and measuring ≥200×200 at both shell
 *      variants, and the IFrame API script injected exactly once;
 *   3. a trusted (CDP input) click on Play starts real playback — position
 *      advances, controls synchronize — and nothing overlays the player
 *      (`elementsFromPoint` at the dock center returns the iframe);
 *   4. client-side navigation Home → Search → Library → Now Playing keeps the
 *      SAME connected iframe element and playback continues;
 *   5. zero console errors for the whole session.
 *
 * Writes `results.json` and screenshots next to this script (the change's
 * `evidence/` directory). Exit code 0 = every assertion passed.
 *
 * Usage:  node cdp-check.mjs   (with the production server already running)
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

/**
 * Deterministic fixture backup mirroring the known-valid M2 shape, with the
 * session queue pointing at a real, stable, embeddable YouTube video so the
 * restored track can actually play in the browser.
 */
const REAL_VIDEO = {
  id: "youtube:jNQXAC9IVRw",
  source: "youtube",
  providerId: "jNQXAC9IVRw",
  title: "Me at the zoo",
  artists: [{ name: "jawed" }],
  artwork: [{ url: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg" }],
  category: "music",
  capabilities: { stream: true, offlineDownload: false },
  durationSeconds: 19,
};

function makeFixture() {
  const track = (id) => ({
    id,
    source: "youtube",
    providerId: `yt-${id}`,
    title: `Title ${id}`,
    artists: [{ name: `Artist ${id}` }],
    artwork: [],
    category: "music",
    capabilities: { stream: true, offlineDownload: false },
  });
  return {
    format: "spotivibe-backup",
    version: 1,
    exportedAt: "2026-09-28T12:00:00.000Z",
    appVersion: "0.1.0",
    data: {
      preferences: {
        languages: ["hi"],
        autoplayNext: true,
        reduceMotion: false,
        onboardingComplete: true,
      },
      likedTracks: [{ trackId: "t1", track: track("t1"), likedAt: 1000 }],
      playlists: [
        {
          id: "p1",
          name: "Road Trip",
          createdAt: 500,
          updatedAt: 600,
          tracks: [{ track: track("t1"), addedAt: 550 }],
        },
      ],
      history: [
        {
          id: "e1",
          trackId: "t1",
          track: track("t1"),
          playedAt: 700,
          secondsPlayed: 30,
          completed: true,
          context: "home",
        },
      ],
      searchHistory: [{ query: "beatles", normalizedQuery: "beatles", searchedAt: 800 }],
      session: {
        queue: [REAL_VIDEO],
        queueIndex: 0,
        positionSeconds: 4,
        repeatMode: "off",
        shuffle: false,
        volume: 0.5,
        updatedAt: 900,
      },
    },
  };
}

/** Player-region DOM sample: transport label, clock, error, volume, iframe. */
const DOM_STATE = `(() => {
  const bar = document.querySelector('[data-testid="player-bar"]');
  const control = bar?.querySelector('button[aria-label="Play"], button[aria-label="Pause"]');
  const iframe = document.querySelector('[data-testid="player-dock"] iframe');
  return {
    control: control?.getAttribute('aria-label') ?? null,
    controlDisabled: control ? control.disabled : null,
    position: bar?.querySelector('[data-testid="progress-position"]')?.textContent ?? null,
    duration: bar?.querySelector('[data-testid="progress-duration"]')?.textContent ?? null,
    error: bar?.querySelector('[role="alert"]')?.textContent ?? null,
    volume: bar?.querySelector('input[aria-label="Volume"]')?.value ?? null,
    dock: !!document.querySelector('[data-testid="player-dock"]'),
    iframe: !!iframe,
    iframeSrc: iframe?.getAttribute('src') ?? null,
    iframeCount: document.querySelectorAll('[data-testid="player-dock"] iframe').length,
    iframeApiScripts: document.querySelectorAll('script[src*="iframe_api"]').length,
    attributionHref: document.querySelector('[data-testid="now-playing-attribution"]')?.getAttribute('href') ?? null,
    attributionTarget: document.querySelector('[data-testid="now-playing-attribution"]')?.getAttribute('target') ?? null,
    attributionRel: document.querySelector('[data-testid="now-playing-attribution"]')?.getAttribute('rel') ?? null,
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
    task: "6.3",
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    target: `${ORIGIN}/settings`,
    steps: [],
    screenshots: [],
    consoleErrors: [],
    autoplayBlocked: false,
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
    const target = await newTarget(`${ORIGIN}/settings`);
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
    /** Real input events over CDP — a trusted user gesture (autoplay policy). */
    const trustedClick = async (selector) => {
      const point = await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height };
      })()`);
      if (!point || point.w === 0 || point.h === 0) {
        throw new Error(`Element not clickable (missing or zero-size): ${selector}`);
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
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("DOM.enable");

    const READY = `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Export backup'); return !!b && !b.disabled; })()`;
    const FEEDBACK = `document.querySelector('[data-testid="data-controls-feedback"]')?.textContent ?? null`;
    const DOCK_READY = `(() => { const d = document.querySelector('[data-testid="player-dock"]'); const i = d?.querySelector('iframe'); return !!i; })()`;

    // ---- 1. import the fixture (session included) ----------------------
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: `${ORIGIN}/settings` });
    await waitFor("settings controls ready (fresh profile, empty database)", READY, Boolean);
    step("settings page ready on a fresh profile", true);

    const fixture = makeFixture();
    const fixturePath = join(profileDir, "fixture-backup.json");
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
    results.fixtureSession = fixture.data.session;

    const doc = await send("DOM.getDocument", { depth: 0 });
    const input = await send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: "input[type=file]",
    });
    if (!input.nodeId) throw new Error("Import file input not found on /settings");
    await send("DOM.setFileInputFiles", { files: [fixturePath], nodeId: input.nodeId });
    await evaluate(
      `document.querySelector('input[type=file]').dispatchEvent(new Event('change', { bubbles: true })); true`,
    );
    const importFeedback = await waitFor(
      "import completion feedback",
      FEEDBACK,
      (text) => typeof text === "string" && /^Import complete/.test(text),
      30000,
    );
    results.importFeedback = importFeedback;
    step(
      "imported backup fixture (session dataset included)",
      /session updated/.test(importFeedback),
      importFeedback,
    );

    // ---- 2. reload: session restores cued/paused, no autoplay -----------
    await send("Page.reload", { ignoreCache: true });
    const restored = await waitFor("docked player surface after reload", DOM_STATE, (s) => s.dock && s.iframe, 30000);
    results.afterRestore = restored;
    step(
      "session restored: dock + iframe present, transport shows the Play affordance",
      restored.control === "Play" && restored.controlDisabled === false,
      `control=${restored.control} disabled=${restored.controlDisabled}`,
    );
    step(
      "restored position displayed at the saved 0:04 (cue at position)",
      restored.position === "0:04",
      `position=${restored.position}, duration=${restored.duration}`,
    );
    step(
      "exactly one IFrame API script and one player iframe",
      restored.iframeApiScripts === 1 && restored.iframeCount === 1,
      `apiScripts=${restored.iframeApiScripts}, iframes=${restored.iframeCount}, src=${restored.iframeSrc}`,
    );
    step("volume boot preference applied (default 80)", restored.volume === "80", `volume=${restored.volume}`);

    await delay(3000); // give any accidental autoplay time to happen
    const stillPaused = await waitFor("post-restore sample", DOM_STATE, (s) => s.iframe, 5000);
    results.threeSecondsAfterRestore = stillPaused;
    step(
      "no autoplay: transport still shows Play at the saved position after 3s",
      stillPaused.control === "Play" && stillPaused.position === "0:04",
      `control=${stillPaused.control}, position=${stillPaused.position}`,
    );

    // ---- 3. surface geometry + overlay check ---------------------------
    const measure = await evaluate(`(() => {
      const el = document.querySelector('[data-testid="player-dock"] iframe');
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    step(
      "desktop dock surface measures ≥200×200 (expected 400×225)",
      measure.w >= 200 && measure.h >= 200,
      `${measure.w}×${measure.h}`,
    );
    const hitTest = await evaluate(`(() => {
      const el = document.querySelector('[data-testid="player-dock"] iframe');
      const r = el.getBoundingClientRect();
      const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { topIsIframe: stack[0] === el, stack: stack.slice(0, 4).map((n) => n.tagName) };
    })()`);
    results.desktopHitTest = hitTest;
    step("elementsFromPoint at dock center returns the player (no overlay)", hitTest.topIsIframe, JSON.stringify(hitTest.stack));
    await shoot(1280, 900, "restore-docked-1280.png", "session restored, cued paused at 0:04");

    await shoot(390, 844, "restore-docked-390.png", "compact shell dock (above MiniPlayer + BottomNav)");
    const compactMeasure = await evaluate(`(() => {
      const el = document.querySelector('[data-testid="player-dock"] iframe');
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    step(
      "compact dock surface measures ≥200×200",
      compactMeasure.w >= 200 && compactMeasure.h >= 200,
      `${compactMeasure.w}×${compactMeasure.h}`,
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(500);

    // Stamp the iframe identity BEFORE navigation: a reload would reset
    // `window.__m4iframe`, so identity after navigation proves the same
    // connected element persisted across client-side route changes.
    await evaluate(`window.__m4iframe = document.querySelector('[data-testid="player-dock"] iframe'); true`);

    // ---- 4. trusted click → real playback ------------------------------
    const clickPoint = await trustedClick('[data-testid="player-bar"] button[aria-label="Play"]');
    results.trustedClick = clickPoint;
    const reachedPause = await waitFor(
      "transport to show Pause after the trusted click",
      DOM_STATE,
      (s) => s.control === "Pause",
      10000,
    ).catch(() => null);
    step("trusted click on Play: controls switch to the Pause affordance", reachedPause !== null, reachedPause ? `control=${reachedPause.control}` : "control never switched");

    let playing = false;
    let blockedDetail = "";
    try {
      const advanced = await waitFor(
        "playback position to advance past the restored 0:04",
        `(${DOM_STATE}).position`,
        (text) => (parseClock(text) ?? 0) > 4,
        30000,
      );
      results.playingPosition = advanced;
      playing = true;
      step("real playback: position advances past the restore point", true, `position=${advanced}`);
    } catch (error) {
      const now = await waitFor("player state after failed advance", DOM_STATE, (s) => s.iframe, 5000).catch(() => null);
      if (now?.control === "Play") {
        results.autoplayBlocked = true;
        blockedDetail = "AUTOPLAY_BLOCKED: transport reverted to Play without position advance (browser blocked the attempt)";
      } else if (now?.error) {
        blockedDetail = `PLAYER_ERROR: ${now.error}`;
      } else {
        blockedDetail = String(error?.message ?? error).slice(0, 300);
      }
      step("real playback: position advances past the restore point", false, blockedDetail);
    }
    await shoot(1280, 900, "playing-1280.png", "playback running, PlayerBar synchronized");

    const positionBeforeNav = parseClock((results.playingPosition ?? results.afterRestore.position)) ?? 4;

    // ---- 5. client-side navigation keeps the same connected player -----
    const nav = async (label, clickExpr, path) => {
      await evaluate(clickExpr);
      const at = await waitFor(`${label} route`, `location.pathname`, (p) => p === path, 15000);
      const check = await waitFor(
        `${label} player state`,
        `(() => {
          const el = document.querySelector('[data-testid="player-dock"] iframe');
          const bar = document.querySelector('[data-testid="player-bar"] button[aria-label="Pause"], [data-testid="player-bar"] button[aria-label="Play"]');
          return { same: el === window.__m4iframe, connected: !!el && el.isConnected, control: bar?.getAttribute('aria-label') ?? null, path: location.pathname };
        })()`,
        (s) => s.path === path,
        10000,
      );
      const ok = check.same && check.connected && (playing ? check.control === "Pause" : true);
      step(`${label}: same connected iframe + synchronized control`, ok, JSON.stringify(check));
      return check;
    };

    await nav("Home", `document.querySelector('a[href="/"]').click(); true`, "/");
    await nav("Search", `document.querySelector('a[href="/search"]').click(); true`, "/search");
    await nav("Library", `document.querySelector('a[href="/library"]').click(); true`, "/library");
    await nav(
      "Now Playing",
      `document.querySelector('[data-testid="player-bar"] a[href="/now-playing"]').click(); true`,
      "/now-playing",
    );

    const finalState = await waitFor("final player state", DOM_STATE, (s) => s.dock, 10000);
    results.finalState = finalState;
    if (playing) {
      const finalPos = parseClock(finalState.position) ?? 0;
      step(
        "playback continued across navigation",
        finalPos > positionBeforeNav,
        `position ${positionBeforeNav}s → ${finalPos}s`,
      );
    }
    step(
      "Now Playing attribution links the watch page in a new tab without referrer suppression",
      finalState.attributionHref === "https://www.youtube.com/watch?v=jNQXAC9IVRw" &&
        finalState.attributionTarget === "_blank" &&
        finalState.attributionRel === "noopener",
      `href=${finalState.attributionHref} target=${finalState.attributionTarget} rel=${finalState.attributionRel}`,
    );
    const pageControl = await evaluate(
      `document.querySelector('main button[aria-label="Pause"], main button[aria-label="Play"]')?.getAttribute('aria-label') ?? null`,
    );
    step(
      "Now Playing page controls synchronized with the store",
      playing ? pageControl === "Pause" : pageControl === "Play",
      `page control=${pageControl}`,
    );
    await shoot(1280, 900, "nowplaying-playing-1280.png", "Now Playing route, same player, attribution visible");

    // ---- 6. console hygiene --------------------------------------------
    step("zero console errors during the whole session", results.consoleErrors.length === 0, results.consoleErrors.join(" | ") || "none");

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
      const response = await fetch(`${ORIGIN}/settings`);
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
