#!/usr/bin/env node
/**
 * M7 task 9.3 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Drives a production build (`next start`) in headless Edge over the Chrome
 * DevTools Protocol to capture what unit tests cannot:
 *   1. fresh profile → hydrated top-bar search → LIVE search results;
 *   2. like from the result menu — the menu flips to "Remove from Liked
 *      Songs" (search-surface consistency);
 *   3. the Liked Songs surface shows the liked row + count; the grid/list
 *      toggle switches views with `aria-pressed`;
 *   4. Shuffle play-all starts real playback from the liked collection;
 *      `/queue` labels it "From your library" with shuffle on;
 *   5. Now Playing's heart matches the liked state; unlike propagates to
 *      Liked Songs (empty state, inert bulk controls) and re-liking
 *      restores the row — like state consistent across all three surfaces;
 *   6. create a playlist from `/library` — grid card + live sidebar entry;
 *   7. add three search results through the playlist picker; re-adding the
 *      first one reports "Already in playlist" with the picker left open;
 *   8. keyboard reorder (focused Move down + trusted Enter) and drag
 *      reorder (CDP drag events, in-page fallback disclosed) both land on
 *      the playlist's ordered rows;
 *   9. a full reload preserves membership and order;
 *  10. rename updates heading + sidebar; delete → Cancel changes nothing,
 *      delete → confirm removes it (grid + sidebar, liked entry kept);
 *  11. import error paths (invalid input, unavailable playlist) then a
 *      LIVE public playlist import with its reported counts;
 *  12. offline: banner + `/library`, playlist detail, and Liked Songs all
 *      render from IndexedDB, and an import attempt fails gracefully with
 *      the offline message; reconnect clears the banner;
 *  13. exactly one player iframe / one IFrame API script, zero console
 *      errors (deliberate offline-window and error-probe network entries
 *      are disclosed, not counted — see README.md).
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

/** Live inputs — each probed against /api/playlist before this run (README). */
const QUERY = "bohemian rhapsody";
const IMPORT_SOURCES = {
  invalid: "https://example.com/not-youtube", // non-YouTube host → 400 invalid_input
  unavailable: "PLAAAAAAAAAAAAAAAAAAAAAA", // parses, never resolves → 404
  live: "PLyORnIW1xT6wFaUUjhKa9Q6vcrxQiy9kc", // public playlist, 50 entries (probed 200)
};

/** Exact copy lifted from the sources at runtime (no encoding assumptions). */
function extractConstants() {
  const banner = readFileSync(join(FRONTEND, "src/components/layout/ConnectionBanner.tsx"), "utf8");
  const importer = readFileSync(
    join(FRONTEND, "src/features/playlists/ImportPlaylistDialog.tsx"),
    "utf8",
  );
  const picker = readFileSync(join(FRONTEND, "src/features/search/PlaylistPicker.tsx"), "utf8");
  const nowPlaying = readFileSync(join(FRONTEND, "src/app/now-playing/page.tsx"), "utf8");
  const queue = readFileSync(join(FRONTEND, "src/features/queue/QueueView.tsx"), "utf8");
  const liked = readFileSync(join(FRONTEND, "src/features/library/LikedSongsView.tsx"), "utf8");
  const pick = (re, source, name) => {
    const value = re.exec(source)?.[1];
    if (!value) throw new Error(`Could not extract ${name} from sources.`);
    return value;
  };
  const requireCopy = (present, name, fallback) => {
    if (!present) throw new Error(`Could not extract ${name} from sources.`);
    return fallback;
  };
  return {
    offlineBanner: pick(/"(You're offline[^"]*)"/, banner, "offline banner copy"),
    importInvalid: pick(/invalid_input: "([^"]+)"/, importer, "invalid_input message"),
    importUnavailable: pick(/playlist_unavailable: "([^"]+)"/, importer, "unavailable message"),
    importNetwork: pick(/network: "([^"]+)"/, importer, "network message"),
    importUpstream: pick(/upstream_unavailable: "([^"]+)"/, importer, "upstream_unavailable message"),
    pickerNoticePrefix: requireCopy(/Already in playlist/.test(picker), "picker notice", "Already in playlist"),
    npRemove: pick(/label=\{isLiked \? "([^"]+)" : /, nowPlaying, "Now Playing liked-state label"),
    npSave: pick(/isLiked \? "[^"]+" : "([^"]+)"\}/, nowPlaying, "Now Playing unliked label"),
    queueSource: requireCopy(/From your library/.test(queue), "queue source label", "From your library"),
    emptyLiked: requireCopy(/No liked songs yet/.test(liked), "liked empty copy", "No liked songs yet"),
  };
}

function parseClock(text) {
  if (typeof text !== "string") return null;
  const parts = text.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
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
    task: "9.3",
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    queries: { search: QUERY },
    importSources: IMPORT_SOURCES,
    copy: COPY,
    steps: [],
    screenshots: [],
    consoleErrors: [],
    notes: {
      disclosures: { offlineWindow: [], importErrorProbe: [], liveUpstream: [] },
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

  // --- multi-target network emulation (the player iframe is an OOPIF) ----
  const cdpSessions = new Set(); // sessionIds ("" = the main session)
  let offlineNow = false;
  let importProbe = false; // deliberate 4xx import-probe window
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
    results.notes.offlineEmulation.calls.push({
      command: `Network.emulateNetworkConditions {offline:${off}}`,
      sessions: [...cdpSessions].map((s) => s || "main"),
    });
    for (const sid of [...cdpSessions]) await enableNetworkOn(sid);
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
    /** Real input events over CDP — a trusted user gesture (autoplay policy). */
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
    /** Evaluate-click for non-trusted surfaces (menus, dialogs). */
    const clickElement = async (elementJs, label) => {
      const ok = await evaluate(
        `(() => { const el = ${elementJs}; if (!el) return false; el.click(); return true; })()`,
      );
      if (!ok) throw new Error(`click target missing: ${label}`);
    };
    /** Printable characters, dispatched as trusted `char` events (M5/M6 pattern). */
    const typeText = async (text, perCharMs = 25) => {
      for (const ch of text) {
        await send("Input.dispatchKeyEvent", { type: "char", text: ch, key: ch });
        if (perCharMs > 0) await delay(perCharMs);
      }
    };
    const keyPress = async ({ key, code, modifiers = 0, windowsVirtualKeyCode, text }) => {
      const base = {
        key,
        code,
        modifiers,
        windowsVirtualKeyCode,
        nativeVirtualKeyCode: windowsVirtualKeyCode,
        // Activation keys (Enter) need their layout text for the browser's
        // default action — a bare keyDown focuses but never clicks a button.
        ...(text ? { text } : {}),
      };
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
      await delay(40);
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    };
    /** Focus an input, select-all + clear, then type a fresh value. */
    const setTextField = async (focusJs, value) => {
      const focused = await evaluate(
        `(() => { const el = ${focusJs}; if (!el) return false; el.focus(); return document.activeElement === el; })()`,
      );
      if (!focused) throw new Error(`input not focusable: ${focusJs}`);
      await keyPress({ key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
      await delay(60);
      await keyPress({ key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
      await delay(80);
      await typeText(value);
      const typed = await evaluate(`(${focusJs})?.value ?? null`);
      if (typed !== value) {
        throw new Error(
          `field did not receive the text: expected ${JSON.stringify(value)} got ${JSON.stringify(typed)}`,
        );
      }
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
    const goto = async (path, readyExpr, readyDesc) => {
      await send("Page.navigate", { url: `${ORIGIN}${path}` });
      await waitFor(`${path} document complete`, `document.readyState`, (r) => r === "complete", 20000);
      await waitFor(`${path}: ${readyDesc}`, readyExpr, Boolean, 30000);
      await delay(300);
    };
    const pathname = () => evaluate(`location.pathname`);

    // ---- console error capture with honest disclosure buckets ----------
    on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        const text = `console.error: ${params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`;
        // Next's router logs "Failed to fetch RSC payload …" when a navigation
        // fetch fails. Inside the emulated offline window this is network-
        // failure noise (same origin as net::ERR_ log lines) → disclosed.
        if (offlineNow && /Failed to fetch RSC payload/.test(text)) {
          results.notes.disclosures.offlineWindow.push(text);
        } else {
          results.consoleErrors.push(text);
        }
      }
    });
    on("Runtime.exceptionThrown", (params) => {
      const text = `exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`.slice(
        0,
        300,
      );
      if (offlineNow && /net::ERR_|Failed to load resource|youtube|ytimg/i.test(text)) {
        results.notes.disclosures.offlineWindow.push(text);
      } else {
        results.consoleErrors.push(text);
      }
    });
    on("Log.entryAdded", (params) => {
      if (params.entry.level !== "error") return;
      const text = `log: ${params.entry.text}`.slice(0, 300);
      const netCut = /net::ERR_|Failed to load resource/.test(params.entry.text);
      const statusErr = /status of [45]\d\d/.test(params.entry.text);
      const liveFlake = /status of (429|503)/.test(params.entry.text);
      if (offlineNow && (netCut || statusErr)) results.notes.disclosures.offlineWindow.push(text);
      else if (liveFlake) results.notes.disclosures.liveUpstream.push(text);
      else if (importProbe && (netCut || statusErr))
        results.notes.disclosures.importErrorProbe.push(text);
      else results.consoleErrors.push(text);
    });

    // Mirror emulated network state onto every attached target (OOPIF).
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
    await send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });

    // Shared page reads -----------------------------------------------
    const HOME_READY = `(() => {
      const input = document.querySelector('input[aria-label="Search"]');
      return !!input && Object.keys(input).some((k) => k.indexOf('__reactProps$') === 0);
    })()`;
    const LIBRARY_READY = `[...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Create playlist')`;
    const LIKED_READY = `(() => {
      const main = document.querySelector('main');
      if (!main) return false;
      return (
        !!main.querySelector('[aria-label="Filter liked songs"]') ||
        (main.textContent || '').includes(${JSON.stringify(COPY.emptyLiked)}) ||
        (main.textContent || '').includes('No matches')
      );
    })()`;
    const PLAYLIST_ROW_IDS = `(() => [...document.querySelectorAll('[data-testid="playlist-track-row"]')].map((r) => r.dataset.trackId ?? ''))()`;
    const ROW_TITLES = `([...document.querySelectorAll('[data-testid="playlist-track-row"] button[aria-label^="Play "]')].map((b) => (b.getAttribute('aria-label') ?? '').replace(/^Play /, '')))`;
    const ALERT_EXPR = `document.querySelector('div[role="dialog"] p[role="alert"]')?.textContent ?? null`;
    const SEARCH_ROWS = '[data-testid="search-results"] li';
    const PICKER = `div[role="dialog"][aria-label="Add to playlist"]`;
    const CREATE_DIALOG = `div[role="dialog"][aria-label="Create playlist"]`;
    const EDIT_DIALOG = `div[role="dialog"][aria-label="Edit playlist"]`;
    const DELETE_DIALOG = `div[role="dialog"][aria-label="Delete playlist?"]`;
    const IMPORT_DIALOG = `div[role="dialog"][aria-label="Import playlist"]`;
    const menuTriggerFor = (index) =>
      `${SEARCH_ROWS}:nth-child(${index + 1}) button[aria-label^="More options"]`;
    const likedRowJs = (title) =>
      `document.querySelector('main button[aria-label=${JSON.stringify(`Remove ${title} from Liked Songs`)}]')`;
    const HEART_EXPR = `document.querySelector('main button[aria-label=${JSON.stringify(COPY.npRemove)}], main button[aria-label=${JSON.stringify(COPY.npSave)}]')?.getAttribute('aria-label') ?? null`;
    const NP_HEART_JS = `document.querySelector('main button[aria-label=${JSON.stringify(COPY.npRemove)}], main button[aria-label=${JSON.stringify(COPY.npSave)}]')`;
    const mainButtonText = (text) =>
      `[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
    // IconButtons carry their name in aria-label only (empty textContent).
    const mainButtonLabel = (label) =>
      `[...document.querySelectorAll('main button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(label)})`;
    const sidebarPlaylist = `[...document.querySelectorAll('aside a[href^="/playlist/"]')].some((a) => a.textContent.includes(%NAME%))`;
    const sidebarPlaylistExpr = (name) => sidebarPlaylist.replace("%NAME%", JSON.stringify(name));

    // Parse self-check: every static page expression must be valid JS before
    // the run starts (catches selector-template typos immediately instead of
    // as a mid-run waitFor timeout).
    for (const [name, expr] of Object.entries({
      HOME_READY,
      LIBRARY_READY,
      LIKED_READY,
      PLAYLIST_ROW_IDS,
      ROW_TITLES,
      ALERT_EXPR,
      HEART_EXPR,
      NP_HEART_JS,
      likedRowJs: likedRowJs("Sample Track"),
      menuTriggerFor: `document.querySelector(${JSON.stringify(menuTriggerFor(0))})`,
      mainButtonText: mainButtonText("Shuffle"),
      mainButtonLabel: mainButtonLabel("Grid view"),
      sidebarPlaylistExpr: sidebarPlaylistExpr("Test"),
    })) {
      try {
        new Function(`return (${expr})`);
      } catch (error) {
        throw new Error(`Expression ${name} does not parse: ${error.message}\n${expr}`);
      }
    }

    const pickEligibleRow = async (desc) => {
      const chosen = await evaluate(`(() => {
        const rows = [...document.querySelectorAll('${SEARCH_ROWS}')];
        const parsed = rows.map((li, index) => {
          const m = /(\\d+):(\\d{2})(?!\\d)/.exec(li.textContent ?? '');
          const seconds = m ? Number(m[1]) * 60 + Number(m[2]) : null;
          return { index, seconds };
        });
        const eligible = parsed.filter(
          (r) => r.seconds !== null && r.seconds >= 120 && r.index <= rows.length - 3,
        );
        return { rows: rows.length, pick: eligible[0] ?? null };
      })()`);
      if (!chosen.pick) throw new Error(`${desc}: no eligible ≥2:00 row (rows=${chosen.rows})`);
      return chosen;
    };
    const rowTitle = (index) =>
      evaluate(`(() => {
        const label = document.querySelector(${JSON.stringify(menuTriggerFor(index))})?.getAttribute('aria-label') ?? '';
        return label.replace(/^More options for /, '');
      })()`);
    const openRowMenu = async (index) => {
      await trustedClickSel(menuTriggerFor(index));
      await waitFor("result menu open", `!!document.querySelector('[role="menu"]')`, Boolean, 8000);
    };
    const clickMenuItem = async (text) => {
      await clickElement(
        `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((i) => i.textContent.trim() === ${JSON.stringify(text)})`,
        `menu item ${text}`,
      );
      await waitFor("menu closed", `!document.querySelector('[role="menu"]')`, Boolean, 8000);
    };
    /** Open the picker for a row and click the named playlist option. */
    const addRowToPlaylist = async (index, playlistName) => {
      await openRowMenu(index);
      await clickMenuItem("Add to playlist");
      await waitFor("picker open", `!!document.querySelector(${JSON.stringify(PICKER)})`, Boolean, 8000);
      await waitFor(
        `picker lists ${playlistName}`,
        `(() => { const d = document.querySelector(${JSON.stringify(PICKER)}); return [...(d?.querySelectorAll('button') ?? [])].some((b) => b.textContent.trim() === ${JSON.stringify(playlistName)}); })()`,
        Boolean,
        8000,
      );
      await clickElement(
        `[...document.querySelector(${JSON.stringify(PICKER)}).querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(playlistName)})`,
        `picker option ${playlistName}`,
      );
    };
    /** Type the query and wait for live results. One bounded retry covers a
     *  transient live-upstream failure (recorded in notes.searchRetries and
     *  disclosed in README.md — an exhausted retry still fails the run). */
    const typeQueryAndWait = async (desc) => {
      const expr = `location.pathname === '/search' && document.querySelectorAll('${SEARCH_ROWS}').length >= 3`;
      await trustedClickSel('input[aria-label="Search"]');
      await delay(150);
      await typeText(QUERY);
      try {
        await waitFor(`${desc} results`, expr, Boolean, 30000);
      } catch {
        results.notes.searchRetries = results.notes.searchRetries ?? [];
        results.notes.searchRetries.push(desc);
        await delay(5000);
        await setTextField(`document.querySelector('input[aria-label="Search"]')`, QUERY);
        await waitFor(`${desc} results (after live-upstream retry)`, expr, Boolean, 30000);
      }
    };

    // ====================================================================
    // STEP 1 — fresh profile, Home hydrated (top-bar search input)
    // ====================================================================
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await goto("/", HOME_READY, "top-bar search input hydrated");
    step("fresh profile loads Home with the hydrated top-bar search", true);

    // ====================================================================
    // STEP 2 — live search; pick a long row for the library flow
    // ====================================================================
    await typeQueryAndWait("initial search");
    const chosen = await pickEligibleRow("initial search");
    const t1Index = chosen.pick.index;
    const t1Title = await rowTitle(t1Index);
    results.notes.chosenRow = { rows: chosen.rows, index: t1Index, title: t1Title };
    step(
      "live search returned rows and a ≥2:00 song for the library flow",
      chosen.rows >= 3,
      `rows=${chosen.rows}, picked index=${t1Index} title="${t1Title}"`,
    );

    // ====================================================================
    // STEP 3 — like from the result menu; the menu flips
    // ====================================================================
    await openRowMenu(t1Index);
    await clickMenuItem("Save to Liked Songs");
    await openRowMenu(t1Index);
    const likeItem = await waitFor(
      "menu to report the liked state",
      `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((i) => i.textContent.trim()).find((t) => t.includes('Liked Songs')) ?? null`,
      (t) => t === COPY.npRemove,
      8000,
    );
    await keyPress({ key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await waitFor("menu closed via Escape", `!document.querySelector('[role="menu"]')`, Boolean, 4000);
    step(
      "like from search flips the result menu to Remove from Liked Songs",
      likeItem === COPY.npRemove,
      `menu item="${likeItem}"`,
    );

    // ====================================================================
    // STEP 4 — Liked Songs surface shows the row and count
    // ====================================================================
    await waitFor(
      "sidebar Liked Songs entry",
      `!!document.querySelector('aside a[href="/library/liked"]')`,
      Boolean,
      15000,
    );
    await trustedClickSel('aside a[href="/library/liked"]');
    await waitFor("liked route", `location.pathname`, (p) => p === "/library/liked", 15000);
    await waitFor("liked surface resolved", LIKED_READY, Boolean, 30000);
    await waitFor("liked row rendered", `!!${likedRowJs(t1Title)}`, Boolean, 15000);
    const likedCount = await evaluate(
      `[...document.querySelectorAll('main p, main span')].map((el) => (el.textContent ?? '').trim()).find((t) => t === '1 song') ?? null`,
    );
    await shoot(1280, 900, "liked-list-1280.png", "/library/liked — list view with the search-liked row");
    step(
      "Liked Songs surface shows the liked row and count",
      likedCount === "1 song",
      `count="${likedCount}", row="Remove ${t1Title} from Liked Songs"`,
    );

    // ====================================================================
    // STEP 5 — grid/list toggle
    // ====================================================================
    const readToggle = () =>
      evaluate(`(() => {
        const main = document.querySelector('main');
        const grid = [...(main?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === 'Grid view');
        const list = [...(main?.querySelectorAll('button') ?? [])].find((b) => b.getAttribute('aria-label') === 'List view');
        return {
          grid: grid?.getAttribute('aria-pressed') ?? null,
          list: list?.getAttribute('aria-pressed') ?? null,
          rows: document.querySelectorAll('main li button[aria-label^="Play "]').length,
          tiles: document.querySelectorAll('main ul.grid > li > button:not([aria-label])').length,
        };
      })()`);
    const toggleBefore = await readToggle();
    await clickElement(mainButtonLabel("Grid view"), "Grid view toggle");
    await waitFor(
      "grid view active",
      readToggle,
      (t) => t.grid === "true" && t.list === "false" && t.rows === 0 && t.tiles >= 1,
      8000,
    );
    await shoot(1280, 900, "liked-grid-1280.png", "/library/liked — grid view (aria-pressed swapped)");
    await clickElement(mainButtonLabel("List view"), "List view toggle");
    const toggleAfter = await waitFor(
      "list view restored",
      readToggle,
      (t) => t.list === "true" && t.grid === "false" && t.rows >= 1,
      8000,
    );
    step(
      "grid/list toggle switches views with aria-pressed",
      toggleBefore.list === "true" && toggleBefore.rows >= 1,
      `before=${JSON.stringify(toggleBefore)}, after=${JSON.stringify(toggleAfter)}`,
    );

    // ====================================================================
    // STEP 6 — Shuffle play-all: real playback from the liked collection
    // ====================================================================
    await trustedClickJs(mainButtonText("Shuffle"), "Liked Songs toolbar Shuffle");
    await waitFor(
      "player dock after Shuffle",
      `(() => {
        const bar = document.querySelector('[data-testid="player-bar"]');
        return (
          !!document.querySelector('[data-testid="player-dock"]') &&
          document.querySelectorAll('[data-testid="player-dock"] iframe').length === 1 &&
          !!bar?.querySelector('button[aria-label="Pause"]')
        );
      })()`,
      Boolean,
      30000,
    );
    const POSITION_EXPR = `document.querySelector('[data-testid="progress-position"]')?.textContent ?? null`;
    const positionAdvanced = (t) => (parseClock(t) ?? -1) > 0;
    let playing = await waitFor("position to advance past 0:00", POSITION_EXPR, positionAdvanced, 20000).catch(
      () => null,
    );
    if (playing === null) {
      // Same fallback as M6: a stuck engine gets one trusted Play press.
      const needsPlay = await evaluate(
        `!!document.querySelector('[data-testid="player-bar"] button[aria-label="Play"]')`,
      );
      if (needsPlay) await trustedClickSel('[data-testid="player-bar"] button[aria-label="Play"]');
      playing = await waitFor("position to advance past 0:00 (after play)", POSITION_EXPR, positionAdvanced, 30000);
    }
    step(
      "shuffle play-all starts real playback from the liked collection",
      positionAdvanced(playing),
      `position=${playing}`,
    );

    // ====================================================================
    // STEP 7 — /queue: From your library + shuffle on; then pause
    // ====================================================================
    await trustedClickSel('[data-testid="player-bar"] button[aria-label^="Queue"]');
    await waitFor("queue route", `location.pathname`, (p) => p === "/queue", 15000);
    const readQueue = () =>
      evaluate(`(() => {
        const bar = document.querySelector('[data-testid="player-bar"]');
        const shuffle = [...document.querySelectorAll('button[aria-label="Shuffle"]')].find(
          (b) => b.getAttribute('aria-pressed') !== null,
        );
        return {
          sourceLabel: (document.body.textContent ?? '').includes(${JSON.stringify(COPY.queueSource)}),
          shufflePressed: shuffle?.getAttribute('aria-pressed') ?? null,
          iframeCount: document.querySelectorAll('[data-testid="player-dock"] iframe').length,
          apiScripts: document.querySelectorAll('script[src*="iframe_api"]').length,
          nowRows: document.querySelectorAll('section[aria-label="Now playing"] [data-testid="queue-row"]').length,
          control: bar?.querySelector('button[aria-label="Play"], button[aria-label="Pause"]')?.getAttribute('aria-label') ?? null,
        };
      })()`);
    const queueState = await waitFor(
      "queue labeled From your library with shuffle on",
      readQueue,
      (q) =>
        q.sourceLabel &&
        q.shufflePressed === "true" &&
        q.iframeCount === 1 &&
        q.apiScripts === 1 &&
        q.nowRows >= 1,
      20000,
    );
    await shoot(1280, 900, "queue-library-1280.png", "/queue — From your library, shuffle on, one iframe");
    step(
      "/queue labels the playback From your library with shuffle on (one iframe / one API script)",
      queueState.control === "Pause",
      `sourceLabel=${queueState.sourceLabel}, shuffle=${queueState.shufflePressed}, control=${queueState.control}, iframes=${queueState.iframeCount}, apiScripts=${queueState.apiScripts}, nowRows=${queueState.nowRows}`,
    );
    // Freeze playback: the rest of the run is surface/persistence work.
    const isPlaying = await evaluate(
      `!!document.querySelector('[data-testid="player-bar"] button[aria-label="Pause"]')`,
    );
    if (isPlaying) {
      await trustedClickSel('[data-testid="player-bar"] button[aria-label="Pause"]');
      await waitFor(
        "paused",
        `!!document.querySelector('[data-testid="player-bar"] button[aria-label="Play"]')`,
        Boolean,
        8000,
      );
    }
    results.notes.pausedAfterQueue = isPlaying;

    // ====================================================================
    // STEP 8 — Now Playing heart matches the liked state; unlike flips it
    // ====================================================================
    await trustedClickSel('[data-testid="player-bar"] a[href="/now-playing"]');
    await waitFor("now-playing route", `location.pathname`, (p) => p === "/now-playing", 15000);
    const heart1 = await waitFor("Now Playing heart present", HEART_EXPR, (h) => h !== null, 15000);
    await shoot(
      1280,
      900,
      "now-playing-like-1280.png",
      "/now-playing — heart matches the liked state",
    );
    await clickElement(NP_HEART_JS, "Now Playing heart");
    const heart2 = await waitFor("heart flips to Save", HEART_EXPR, (h) => h === COPY.npSave, 8000);
    step(
      "Now Playing heart matches the liked state and unlike flips it",
      heart1 === COPY.npRemove && heart2 === COPY.npSave,
      `initial="${heart1}", after unlike="${heart2}"`,
    );

    // ====================================================================
    // STEP 9 — unlike propagates to Liked Songs (empty, inert controls)
    // ====================================================================
    await goto("/library/liked", LIKED_READY, "Liked Songs resolved");
    const emptyShown = await waitFor(
      "empty liked copy",
      `document.querySelector('main')?.textContent?.includes(${JSON.stringify(COPY.emptyLiked)}) ?? false`,
      Boolean,
      15000,
    );
    const inert = await evaluate(`(() => {
      const play = document.querySelector('main button[aria-label="Play all"]');
      const shuffle = [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Shuffle');
      return { playAllDisabled: play?.disabled ?? null, shuffleDisabled: shuffle?.disabled ?? null };
    })()`);
    step(
      "unlike from Now Playing clears Liked Songs (empty state, inert bulk controls)",
      emptyShown && inert.playAllDisabled === true && inert.shuffleDisabled === true,
      `emptyShown=${emptyShown}, playAllDisabled=${inert.playAllDisabled}, shuffleDisabled=${inert.shuffleDisabled}`,
    );

    // ====================================================================
    // STEP 10 — re-like from Now Playing restores the Liked Songs row
    // ====================================================================
    await trustedClickSel('[data-testid="player-bar"] a[href="/now-playing"]');
    await waitFor("now-playing route (2nd)", `location.pathname`, (p) => p === "/now-playing", 15000);
    await waitFor("heart ready to re-save", HEART_EXPR, (h) => h === COPY.npSave, 15000);
    await clickElement(NP_HEART_JS, "Now Playing heart (re-like)");
    await waitFor("heart re-liked", HEART_EXPR, (h) => h === COPY.npRemove, 8000);
    await goto("/library/liked", LIKED_READY, "Liked Songs resolved");
    await waitFor("liked row restored", `!!${likedRowJs(t1Title)}`, Boolean, 15000);
    step(
      "re-like from Now Playing restores the Liked Songs row",
      true,
      `row="Remove ${t1Title} from Liked Songs"`,
    );

    // ====================================================================
    // STEP 11 — create a playlist from /library (grid + live sidebar)
    // ====================================================================
    await goto("/library", LIBRARY_READY, "Your Library resolved");
    await clickElement(mainButtonText("Create playlist"), "Create playlist");
    await waitFor("create dialog", `!!document.querySelector(${JSON.stringify(CREATE_DIALOG)})`, Boolean, 8000);
    await setTextField(`document.querySelector('#playlist-form-name')`, "Road Trip");
    await clickElement(
      `document.querySelector(${JSON.stringify(CREATE_DIALOG)})?.querySelector('button[type="submit"]')`,
      "create submit",
    );
    await waitFor(
      "create dialog closed",
      `!document.querySelector(${JSON.stringify(CREATE_DIALOG)})`,
      Boolean,
      8000,
    );
    await waitFor(
      "playlist card on grid",
      `[...document.querySelectorAll('main a[href^="/playlist/"]')].some((a) => a.textContent.includes('Road Trip'))`,
      Boolean,
      10000,
    );
    await waitFor(
      "live sidebar entry",
      `[...document.querySelectorAll('aside a[href^="/playlist/"]')].some((a) => a.textContent.includes('Road Trip'))`,
      Boolean,
      10000,
    );
    await shoot(1280, 900, "library-create-1280.png", "/library — Road Trip card + live sidebar entry");
    step(
      "create playlist appears on the grid and the live sidebar entry",
      true,
      `card + sidebar entry "Road Trip" (no reload)`,
    );

    // ====================================================================
    // STEP 12 — add from search: picker closes on success
    // ====================================================================
    await typeQueryAndWait("add phase");
    const chosen2 = await pickEligibleRow("add phase");
    const addIndex = chosen2.pick.index;
    const addTitle0 = await rowTitle(addIndex);
    await addRowToPlaylist(addIndex, "Road Trip");
    await waitFor("picker closed after add", `!document.querySelector(${JSON.stringify(PICKER)})`, Boolean, 8000);
    step(
      "add from search closes the picker on success",
      true,
      `added row index=${addIndex} "${addTitle0}" → "Road Trip"`,
    );

    // ====================================================================
    // STEP 13 — re-add reports "Already in playlist", picker stays open
    // ====================================================================
    await addRowToPlaylist(addIndex, "Road Trip");
    const noticeExpr = `document.querySelector(${JSON.stringify(PICKER)})?.querySelector('p[role="status"]')?.textContent ?? null`;
    const notice = await waitFor(
      "duplicate notice",
      noticeExpr,
      (t) => typeof t === "string" && t.startsWith(COPY.pickerNoticePrefix),
      8000,
    );
    const pickerStillOpen = await evaluate(`!!document.querySelector(${JSON.stringify(PICKER)})`);
    await shoot(
      1280,
      900,
      "duplicate-feedback-1280.png",
      "playlist picker — Already in playlist notice, picker still open",
    );
    await clickElement(
      `document.querySelector(${JSON.stringify(PICKER)}) && [...document.querySelector(${JSON.stringify(PICKER)}).querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close')`,
      "picker Close",
    );
    await waitFor("picker closed", `!document.querySelector(${JSON.stringify(PICKER)})`, Boolean, 8000);
    step(
      "re-adding reports Already in playlist and keeps the picker open",
      pickerStillOpen && notice.startsWith(COPY.pickerNoticePrefix),
      `pickerOpen=${pickerStillOpen}, notice="${notice}"`,
    );

    // Membership: two more distinct rows join the playlist.
    await addRowToPlaylist(addIndex + 1, "Road Trip");
    await waitFor("picker closed (row 2)", `!document.querySelector(${JSON.stringify(PICKER)})`, Boolean, 8000);
    await addRowToPlaylist(addIndex + 2, "Road Trip");
    await waitFor("picker closed (row 3)", `!document.querySelector(${JSON.stringify(PICKER)})`, Boolean, 8000);

    // ====================================================================
    // STEP 14 — detail renders the three tracks in add order
    // ====================================================================
    await waitFor(
      "sidebar playlist entry",
      `!!document.querySelector('aside a[href^="/playlist/"]')`,
      Boolean,
      10000,
    );
    await trustedClickSel('aside a[href^="/playlist/"]');
    await waitFor("playlist route", `location.pathname`, (p) => p.startsWith("/playlist/"), 15000);
    await waitFor("detail heading", `document.querySelector('main h1')?.textContent ?? null`, (t) => t === "Road Trip", 30000);
    const idsBefore = await waitFor("three rows", PLAYLIST_ROW_IDS, (ids) => ids.length === 3, 15000);
    const titlesBefore = await evaluate(ROW_TITLES);
    step(
      "playlist detail renders the three added tracks in add order",
      titlesBefore[0] === addTitle0 && titlesBefore.length === 3,
      `ids=[${idsBefore.join(", ")}], titles=${JSON.stringify(titlesBefore)}`,
    );

    // ====================================================================
    // STEP 15 — keyboard reorder (focused Move down + trusted Enter)
    // ====================================================================
    const expectedKeyboard = [idsBefore[1], idsBefore[0], idsBefore[2]];
    const focused = await evaluate(`(() => {
      const row = document.querySelectorAll('[data-testid="playlist-track-row"]')[0];
      const btn = row?.querySelector('button[aria-label="Move down"]');
      if (!btn || btn.disabled) return false;
      btn.focus();
      return document.activeElement === btn;
    })()`);
    if (!focused) throw new Error("row1 Move down control not focusable");
    await delay(200);
    const focusedLabel = await evaluate(
      `document.activeElement?.getAttribute('aria-label') ?? null`,
    );
    if (focusedLabel !== "Move down") {
      throw new Error(`focus lost before Enter (activeElement=${focusedLabel})`);
    }
    await keyPress({ key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    const idsKeyboard = await waitFor(
      "keyboard reorder",
      PLAYLIST_ROW_IDS,
      (ids) => ids.join() === expectedKeyboard.join(),
      8000,
    );
    step(
      "keyboard reorder swaps playlist rows",
      idsKeyboard.join() === expectedKeyboard.join(),
      `${idsBefore.join(",")} → ${idsKeyboard.join(",")} (Move down + Enter on row 1)`,
    );

    // ====================================================================
    // STEP 16 — drag reorder (CDP drag events, in-page fallback)
    // ====================================================================
    const expectedDrag = [idsKeyboard[2], idsKeyboard[0], idsKeyboard[1]]; // move(2 → 0)
    const points = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-testid="playlist-track-row"]')];
      const rect = (el) => {
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
      };
      return { from: rect(rows[2]), to: rect(rows[0]) };
    })()`);
    const dragData = { items: [{ type: "text/plain", stringData: "2" }], dragOperationsMask: 65535 };
    let dragMethod = "CDP Input.dispatchDragEvent";
    try {
      await send("Input.dispatchDragEvent", {
        type: "dragStart",
        x: points.from.x,
        y: points.from.y,
        data: dragData,
      });
      await delay(150);
      await send("Input.dispatchDragEvent", {
        type: "dragOver",
        x: points.to.x,
        y: points.to.y,
        data: dragData,
      });
      await delay(150);
      await send("Input.dispatchDragEvent", {
        type: "drop",
        x: points.to.x,
        y: points.to.y,
        data: dragData,
      });
      await delay(300);
    } catch (error) {
      results.notes.dragCdpError = String(error?.message ?? error);
    }
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4 }).catch(() => undefined);
    let idsDrag = await evaluate(PLAYLIST_ROW_IDS);
    if (idsDrag.join() !== expectedDrag.join()) {
      // Fallback: in-page DragEvent dispatch across separate evaluates so
      // React flushes dragstart state before drop runs (disclosed in README).
      dragMethod = "in-page DragEvent dispatch (fallback)";
      const fire = (type, index) =>
        evaluate(`(() => {
          const rows = [...document.querySelectorAll('[data-testid="playlist-track-row"]')];
          const dt = new DataTransfer();
          rows[${index}].dispatchEvent(
            new DragEvent('${type}', { bubbles: true, cancelable: true, dataTransfer: dt }),
          );
          return true;
        })()`);
      await fire("dragstart", 2);
      await delay(200);
      await fire("dragover", 0);
      await delay(200);
      await fire("drop", 0);
      await delay(300);
      await fire("dragend", 2);
      await delay(200);
      idsDrag = await evaluate(PLAYLIST_ROW_IDS);
    }
    results.notes.dragMethod = dragMethod;
    const dragOk = idsDrag.join() === expectedDrag.join();
    step(
      "drag reorder drops playlist rows into the new order",
      dragOk,
      `method=${dragMethod}: ${idsKeyboard.join(",")} → ${idsDrag.join(",")}`,
    );

    // ====================================================================
    // STEP 17 — reload preserves membership and order
    // ====================================================================
    const idsFinal = await evaluate(PLAYLIST_ROW_IDS);
    await send("Page.reload", {});
    await waitFor("reload document complete", `document.readyState`, (r) => r === "complete", 20000);
    await waitFor(
      "reload heading",
      `document.querySelector('main h1')?.textContent ?? null`,
      (t) => t === "Road Trip",
      30000,
    );
    const idsReload = await waitFor(
      "reloaded rows match pre-reload order",
      PLAYLIST_ROW_IDS,
      (ids) => ids.join() === idsFinal.join(),
      15000,
    );
    await shoot(
      1280,
      900,
      "playlist-reload-1280.png",
      "/playlist/[id] — membership + order preserved after reload",
    );
    step(
      "reload preserves playlist membership and order",
      idsReload.length === 3,
      `${idsFinal.join(",")} → ${idsReload.join(",")} (3 rows)`,
    );

    // ====================================================================
    // STEP 18 — rename updates heading and sidebar entry
    // ====================================================================
    await clickElement(mainButtonText("Edit"), "Edit");
    await waitFor("edit dialog", `!!document.querySelector(${JSON.stringify(EDIT_DIALOG)})`, Boolean, 8000);
    await setTextField(`document.querySelector('#playlist-form-name')`, "Coastal Drive");
    await clickElement(
      `document.querySelector(${JSON.stringify(EDIT_DIALOG)})?.querySelector('button[type="submit"]')`,
      "edit submit",
    );
    await waitFor(
      "renamed heading",
      `document.querySelector('main h1')?.textContent ?? null`,
      (t) => t === "Coastal Drive",
      15000,
    );
    await waitFor(
      "sidebar entry renamed",
      sidebarPlaylistExpr("Coastal Drive"),
      Boolean,
      10000,
    );
    await shoot(
      1280,
      900,
      "playlist-renamed-1280.png",
      "/playlist/[id] — renamed to Coastal Drive, sidebar updated live",
    );
    step(
      "rename updates the detail heading and sidebar entry",
      true,
      `heading + sidebar now "Coastal Drive"`,
    );

    // ====================================================================
    // STEP 19 — delete: cancel changes nothing; confirm removes it
    // ====================================================================
    const toolbarDeleteJs = mainButtonText("Delete");
    await clickElement(toolbarDeleteJs, "toolbar Delete");
    await waitFor(
      "delete dialog quotes the current name",
      `(() => { const d = document.querySelector(${JSON.stringify(DELETE_DIALOG)}); return !!d && (d.textContent ?? '').includes('Coastal Drive'); })()`,
      Boolean,
      8000,
    );
    await clickElement(
      `document.querySelector(${JSON.stringify(DELETE_DIALOG)}) && [...document.querySelector(${JSON.stringify(DELETE_DIALOG)}).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel')`,
      "Cancel",
    );
    await waitFor(
      "cancel closes dialog",
      `!document.querySelector(${JSON.stringify(DELETE_DIALOG)})`,
      Boolean,
      8000,
    );
    const afterCancel = await evaluate(`(() => ({
      heading: document.querySelector('main h1')?.textContent ?? null,
      sidebar: ${sidebarPlaylistExpr("Coastal Drive")},
    }))()`);
    await clickElement(toolbarDeleteJs, "toolbar Delete (2nd)");
    await waitFor("delete dialog (2nd)", `!!document.querySelector(${JSON.stringify(DELETE_DIALOG)})`, Boolean, 8000);
    await clickElement(
      `document.querySelector(${JSON.stringify(DELETE_DIALOG)})?.querySelector('button[type="submit"]')`,
      "delete confirm",
    );
    await waitFor("navigated to /library", `location.pathname`, (p) => p === "/library", 15000);
    await waitFor(
      "delete dialog closed",
      `!document.querySelector(${JSON.stringify(DELETE_DIALOG)})`,
      Boolean,
      8000,
    );
    await waitFor(
      "card removed from grid",
      `![...document.querySelectorAll('main a[href^="/playlist/"]')].some((a) => a.textContent.includes('Coastal Drive'))`,
      Boolean,
      10000,
    );
    await waitFor(
      "sidebar entry removed",
      `![...document.querySelectorAll('aside a[href^="/playlist/"]')].some((a) => a.textContent.includes('Coastal Drive'))`,
      Boolean,
      10000,
    );
    const likedEntryKept = await evaluate(
      `!!document.querySelector('aside a[href="/library/liked"]')`,
    );
    await shoot(
      1280,
      900,
      "library-after-delete-1280.png",
      "/library — Coastal Drive gone from grid + sidebar, Liked Songs entry kept",
    );
    step(
      "delete cancel changes nothing; confirm removes the playlist",
      afterCancel.heading === "Coastal Drive" && afterCancel.sidebar && likedEntryKept,
      `cancel kept heading="${afterCancel.heading}" sidebar=${afterCancel.sidebar}; confirm → grid+sidebar clear, liked entry kept=${likedEntryKept}`,
    );

    // ====================================================================
    // STEPS 20–22 — import error paths, then the LIVE playlist import
    // ====================================================================
    await clickElement(mainButtonText("Import playlist"), "Import playlist");
    await waitFor("import dialog", `!!document.querySelector(${JSON.stringify(IMPORT_DIALOG)})`, Boolean, 8000);
    const submitImport = (label) =>
      clickElement(
        `document.querySelector(${JSON.stringify(IMPORT_DIALOG)})?.querySelector('button[type="submit"]')`,
        label,
      );

    importProbe = true;
    await setTextField(`document.querySelector('#import-playlist-source')`, IMPORT_SOURCES.invalid);
    await submitImport("import submit (invalid)");
    const alert1 = await waitFor(
      "invalid-input alert",
      ALERT_EXPR,
      (t) => t === COPY.importInvalid,
      15000,
    );
    step(
      "import invalid input shows the invalid-input message",
      alert1 === COPY.importInvalid,
      `alert="${alert1}"`,
    );

    await setTextField(`document.querySelector('#import-playlist-source')`, IMPORT_SOURCES.unavailable);
    await submitImport("import submit (unavailable)");
    let alert2 = await waitFor(
      "unavailable alert",
      ALERT_EXPR,
      (t) => t === COPY.importUnavailable || t === COPY.importUpstream,
      90000,
    ).catch(() => null);
    if (alert2 === COPY.importUpstream) {
      // Live upstream flake (429/503) during the probe — bounded single retry.
      results.notes.unavailableRetries = (results.notes.unavailableRetries ?? 0) + 1;
      await delay(4000);
      await submitImport("import submit (unavailable retry)");
      alert2 = await waitFor(
        "unavailable alert (retry)",
        ALERT_EXPR,
        (t) => t === COPY.importUnavailable || t === COPY.importUpstream,
        90000,
      );
    }
    importProbe = false;
    step(
      "import unavailable playlist shows the unavailable message",
      alert2 === COPY.importUnavailable,
      `alert="${alert2}"`,
    );

    await setTextField(`document.querySelector('#import-playlist-source')`, IMPORT_SOURCES.live);
    await submitImport("import submit (live)");
    let successText = await waitFor(
      "import success summary",
      `document.querySelector('div[role="dialog"]')?.textContent ?? ''`,
      (t) => /Imported \d+ songs?/.test(t),
      60000,
    ).catch(() => null);
    if (successText === null) {
      const failAlert = await evaluate(ALERT_EXPR).catch(() => null);
      if (failAlert && failAlert !== COPY.importUpstream) {
        throw new Error(`live import failed with unexpected alert: ${failAlert}`);
      }
      // Live upstream flake — bounded single retry (README discloses counts).
      results.notes.importRetries = (results.notes.importRetries ?? 0) + 1;
      await delay(4000);
      await submitImport("import submit (live retry)");
      successText = await waitFor(
        "import success summary (retry)",
        `document.querySelector('div[role="dialog"]')?.textContent ?? ''`,
        (t) => /Imported \d+ songs?/.test(t),
        60000,
      );
    }
    const importedCount = Number(/Imported (\d+) songs?/.exec(successText)?.[1] ?? 0);
    const skippedLine = /(\d+ unavailable entr(?:y|ies) skipped)/.exec(successText)?.[1] ?? null;
    const truncatedLine = /First 500 songs imported/.test(successText)
      ? "First 500 songs imported"
      : null;
    results.notes.importSummary = {
      text: successText.replace(/\s+/g, " ").trim().slice(0, 300),
      imported: importedCount,
      skippedLine,
      truncatedLine,
    };
    await waitFor("auto-navigated to detail", `location.pathname`, (p) => p.startsWith("/playlist/"), 15000);
    const importedTitle = await waitFor(
      "imported detail heading",
      `document.querySelector('main h1')?.textContent ?? null`,
      (t) => typeof t === "string" && t.length > 0,
      30000,
    );
    const importedRows = await waitFor(
      "imported rows rendered",
      PLAYLIST_ROW_IDS,
      (ids) => ids.length >= 1,
      15000,
    );
    await shoot(
      1280,
      900,
      "import-detail-1280.png",
      "imported playlist detail — created from the live public playlist",
    );
    step(
      "live public playlist import creates the playlist and reports counts",
      importedCount >= 1 && importedRows.length === importedCount,
      `src=${IMPORT_SOURCES.live}, title="${importedTitle}", rows=${importedRows.length}, summary="${results.notes.importSummary.text}", skipped=${skippedLine}, truncated=${truncatedLine}`,
    );

    // ====================================================================
    // STEP 23 — pre-populate this document's history, then go offline at
    // /library. Offline <Link> clicks cannot work without the service worker
    // (M13 owns the offline shell): Next's RSC-fetch fallback falls back to a
    // browser navigation the offline document does not survive (verified in a
    // separate probe — README.md). History popstate navigation, however, is
    // served from the in-memory router cache, so every offline movement below
    // uses the TopBar's Go back / Go forward controls. Current entry:
    // imported detail (entry3); push Liked Songs (entry4), then back twice →
    // /library (entry2) with forward entries [detail, liked] ready.
    // ====================================================================
    await waitFor(
      "sidebar Liked Songs entry (online)",
      `!!document.querySelector('aside a[href="/library/liked"]')`,
      Boolean,
      10000,
    );
    await trustedClickSel('aside a[href="/library/liked"]');
    await waitFor("liked route (online)", `location.pathname`, (p) => p === "/library/liked", 15000);
    await waitFor("liked row (online)", `!!${likedRowJs(t1Title)}`, Boolean, 30000);
    await trustedClickSel('header button[aria-label="Go back"]');
    await waitFor(
      "back at imported detail (online)",
      `location.pathname`,
      (p) => p.startsWith("/playlist/"),
      15000,
    );
    await trustedClickSel('header button[aria-label="Go back"]');
    await waitFor("offline base at /library", `location.pathname`, (p) => p === "/library", 15000);
    await waitFor("/library: Your Library resolved", LIBRARY_READY, Boolean, 30000);
    await waitFor(
      "imported card present before going offline",
      `[...document.querySelectorAll('main a[href^="/playlist/"]')].some((a) => a.textContent.includes(${JSON.stringify(importedTitle)}))`,
      Boolean,
      15000,
    );

    await setOffline(true);
    const bannerState = await waitFor(
      "offline banner",
      `(() => {
        const b = document.querySelector('[data-testid="connection-banner"]');
        return {
          onLine: navigator.onLine,
          connection: b?.getAttribute('data-connection') ?? null,
          text: b?.textContent ?? '',
        };
      })()`,
      (s) => s.onLine === false && s.connection === "offline" && s.text.includes(COPY.offlineBanner),
      20000,
    );
    const offlineLibrary = await evaluate(`(() => ({
      createButton: [...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Create playlist'),
      playlistCards: document.querySelectorAll('main a[href^="/playlist/"]').length,
      likedCard: !!document.querySelector('main a[href="/library/liked"]'),
    }))()`);
    step(
      "offline banner appears and /library renders from IndexedDB",
      offlineLibrary.createButton && offlineLibrary.playlistCards >= 1 && offlineLibrary.likedCard,
      `banner="${COPY.offlineBanner}", onLine=${bannerState.onLine}, playlistCards=${offlineLibrary.playlistCards}, likedCard=${offlineLibrary.likedCard}`,
    );

    // ====================================================================
    // STEP 24 — offline: detail + Liked Songs render fully from IndexedDB
    // via history popstate (Go forward — router cache, no network)
    // ====================================================================
    await trustedClickSel('header button[aria-label="Go forward"]');
    await waitFor("offline detail route", `location.pathname`, (p) => p.startsWith("/playlist/"), 15000);
    const offlineDetail = await waitFor(
      "offline detail rendered from IndexedDB",
      `(() => {
        const heading = document.querySelector('main h1')?.textContent ?? null;
        const rows = document.querySelectorAll('[data-testid="playlist-track-row"]').length;
        const banner = document.querySelector('[data-testid="connection-banner"]')?.getAttribute('data-connection') ?? null;
        return { heading, rows, banner };
      })()`,
      (d) => d.heading === importedTitle && d.rows >= 1 && d.banner === "offline",
      30000,
    );
    await shoot(
      1280,
      900,
      "offline-detail-1280.png",
      "/playlist/[id] offline — rows rendered from IndexedDB, banner visible",
    );
    await trustedClickSel('header button[aria-label="Go forward"]');
    await waitFor("offline liked route", `location.pathname`, (p) => p === "/library/liked", 15000);
    const offlineLiked = await waitFor(
      "offline liked rendered from IndexedDB",
      `(() => ({
        row: !!${likedRowJs(t1Title)},
        heading: document.querySelector('main h1')?.textContent ?? null,
        banner: document.querySelector('[data-testid="connection-banner"]')?.getAttribute('data-connection') ?? null,
      }))()`,
      (s) => s.row && s.heading === "Liked Songs" && s.banner === "offline",
      30000,
    );
    step(
      "offline: playlist detail and Liked Songs render fully from IndexedDB",
      offlineDetail.rows >= 1 && offlineLiked.row,
      `detail rows=${offlineDetail.rows} heading="${offlineDetail.heading}"; liked row=${offlineLiked.row}; banners=${offlineDetail.banner}/${offlineLiked.banner}`,
    );

    // ====================================================================
    // STEP 25 — back to /library (client history) + offline import failure
    // ====================================================================
    let backPath = await pathname();
    let backGuard = 0;
    while (backPath !== "/library" && backGuard < 6) {
      backGuard += 1;
      const before = backPath;
      await trustedClickSel('button[aria-label="Go back"]');
      try {
        await waitFor(`history step ${backGuard}`, `location.pathname`, (p) => p !== before, 6000);
      } catch {
        /* keep clicking until the guard expires */
      }
      backPath = await pathname();
    }
    if (backPath !== "/library") {
      throw new Error(`offline back-loop did not reach /library (stuck at ${backPath})`);
    }
    await waitFor(
      "import trigger offline",
      `[...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Import playlist')`,
      Boolean,
      20000,
    );
    await clickElement(mainButtonText("Import playlist"), "Import playlist (offline)");
    await waitFor("import dialog (offline)", `!!document.querySelector(${JSON.stringify(IMPORT_DIALOG)})`, Boolean, 8000);
    // The live source was imported online seconds earlier and its 200 response
    // is still fresh in the HTTP cache (`public, max-age=60`); a cache hit
    // would SUCCEED offline instead of exercising the designed network-
    // failure path (observed in an earlier live run — README.md discloses
    // this). Clear the cache so the probe issues a real request, which the
    // emulated offline network rejects.
    await send("Network.clearBrowserCache");
    await setTextField(`document.querySelector('#import-playlist-source')`, IMPORT_SOURCES.live);
    await clickElement(
      `document.querySelector(${JSON.stringify(IMPORT_DIALOG)})?.querySelector('button[type="submit"]')`,
      "import submit (offline)",
    );
    let offlineAlert = null;
    try {
      offlineAlert = await waitFor(
        "offline import alert",
        ALERT_EXPR,
        (t) => t === COPY.importNetwork,
        20000,
      );
    } catch (error) {
      // Capture the dialog/page state so a timeout is diagnosable.
      const diag = await evaluate(`(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        return {
          pathname: location.pathname,
          onLine: navigator.onLine,
          dialogPresent: !!dialog,
          alert: dialog?.querySelector('p[role="alert"]')?.textContent ?? null,
          status: dialog?.querySelector('p[role="status"]')?.textContent ?? null,
          body: (document.body?.textContent ?? '').slice(0, 200),
        };
      })()`).catch(() => "diagnostics unavailable");
      throw new Error(`${error.message} | state=${JSON.stringify(diag)}`);
    }
    await shoot(
      1280,
      900,
      "offline-import-error-1280.png",
      "/library — offline import fails gracefully with the offline message",
    );
    await clickElement(
      `document.querySelector(${JSON.stringify(IMPORT_DIALOG)}) && [...document.querySelector(${JSON.stringify(IMPORT_DIALOG)}).querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close')`,
      "import Close",
    );
    await waitFor(
      "import dialog closed",
      `!document.querySelector(${JSON.stringify(IMPORT_DIALOG)})`,
      Boolean,
      8000,
    );
    step(
      "offline import fails gracefully with the offline message",
      offlineAlert === COPY.importNetwork,
      `alert="${offlineAlert}", backs=${backGuard}, path=${backPath}`,
    );

    // ====================================================================
    // STEP 26 — reconnect clears the banner
    // ====================================================================
    await setOffline(false);
    const bannerGone = await waitFor(
      "banner cleared on reconnect",
      `(() => ({
        onLine: navigator.onLine,
        banner: !!document.querySelector('[data-testid="connection-banner"]'),
      }))()`,
      (s) => s.onLine === true && s.banner === false,
      20000,
    );
    step(
      "reconnect clears the banner",
      bannerGone.onLine === true && bannerGone.banner === false,
      `onLine=${bannerGone.onLine}, banner=${bannerGone.banner}`,
    );

    // ====================================================================
    // STEP 27 — exactly one iframe / one IFrame API script
    // ====================================================================
    const finalCounts = await evaluate(`(() => {
      const bar = document.querySelector('[data-testid="player-bar"]');
      const shuffle = [...document.querySelectorAll('button[aria-label="Shuffle"]')].find(
        (b) => b.getAttribute('aria-pressed') !== null,
      );
      return {
        iframeCount: document.querySelectorAll('[data-testid="player-dock"] iframe').length,
        apiScripts: document.querySelectorAll('script[src*="iframe_api"]').length,
        shufflePressed: shuffle?.getAttribute('aria-pressed') ?? null,
        control: bar?.querySelector('button[aria-label="Play"], button[aria-label="Pause"]')?.getAttribute('aria-label') ?? null,
      };
    })()`);
    step(
      "exactly one player iframe and one IFrame API script",
      finalCounts.iframeCount === 1 && finalCounts.apiScripts === 1,
      `iframes=${finalCounts.iframeCount}, apiScripts=${finalCounts.apiScripts}, shuffle=${finalCounts.shufflePressed}, control=${finalCounts.control}`,
    );

    // ====================================================================
    // STEP 28 — zero console errors (disclosed entries excluded)
    // ====================================================================
    step(
      "zero console errors (disclosed offline/probe entries excluded)",
      results.consoleErrors.length === 0,
      `errors=${results.consoleErrors.length}, disclosed offline=${results.notes.disclosures.offlineWindow.length}, disclosed import-probe=${results.notes.disclosures.importErrorProbe.length}, disclosed live-upstream=${results.notes.disclosures.liveUpstream.length}`,
    );
  } catch (error) {
    results.error = String(error?.stack ?? error);
    console.error(`EVIDENCE RUN FAILED: ${results.error}`);
  } finally {
    results.pass =
      !results.error && results.steps.length > 0 && results.steps.every((s) => s.ok);
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
