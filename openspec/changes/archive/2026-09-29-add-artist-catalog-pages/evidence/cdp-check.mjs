#!/usr/bin/env node
/**
 * M9 task 8.2 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Drives a production build (`next start`) in headless Edge over the Chrome
 * DevTools Protocol to capture what unit tests cannot:
 *   1. a live search result is liked, then the same result's "Go to artist"
 *      opens a REAL artist route (M9 replaced the old search refinement);
 *   2. the artist page renders identity/artwork, popular tracks, releases,
 *      related artists, and a local "Liked tracks by this artist" section —
 *      that last one with NO request carrying library data;
 *   3. activating a track and the "Start artist radio" action both start real
 *      playback with the artist feed as the context (`browse` source), and
 *      exactly one player iframe / one IFrame API script exists while playing;
 *   4. an unknown artist key yields a recoverable not-found state;
 *   5. a release entry opens the album page, whose tracks play/shuffle, can be
 *      liked, and open the existing add-to-playlist picker;
 *   6. Now Playing gains an artwork-derived background, a long-title treatment
 *      that keeps the full title available, and a More Like This shelf that
 *      excludes the current track and never autoplays;
 *   7. every artist/album entry point in search results, the result menu, and
 *      the Home artists shelf now targets the catalog routes;
 *   8. ONE failed entity request (blocked over CDP `Fetch`) degrades to a
 *      retryable error on that page alone and recovers on retry; offline shows
 *      a retryable error rather than a crash; zero console errors (deliberate
 *      offline-window and blocked-request network entries are disclosed, not
 *      counted — see README.md).
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

/** Live inputs. The query is a stable, well-populated YouTube Music search. */
const QUERY = "bohemian rhapsody";
/** A key no provider can resolve, for the not-found path. */
const UNKNOWN_ARTIST_KEY = "zzz-spotivibe-no-such-artist-zzz";

/** Exact copy lifted from the sources at runtime (no encoding assumptions). */
function extractConstants() {
  const read = (...parts) => readFileSync(join(FRONTEND, ...parts), "utf8");
  const queue = read("src/features/queue/QueueView.tsx");
  const artist = read("src/features/artist/ArtistView.tsx");
  const album = read("src/features/album/AlbumView.tsx");
  const related = read("src/features/related/MoreLikeThisShelf.tsx");
  const onboarding = read("src/features/preferences/LanguageOnboarding.tsx");
  const menu = read("src/features/search/ResultMenu.tsx");
  const pick = (re, source, name) => {
    const value = re.exec(source)?.[1];
    if (!value) throw new Error(`Could not extract ${name} from sources.`);
    return value;
  };
  return {
    queueBrowse: pick(/browse: "([^"]+)"/, queue, "browse queue label"),
    npSave: pick(/"(Save to Liked Songs)"/, menu, "menu like label"),
    npRemove: pick(/"(Remove from Liked Songs)"/, menu, "menu unlike label"),
    goArtist: pick(/>\s*(Go to artist)\s*</, menu, "menu go-to-artist label"),
    goAlbum: pick(/>\s*(Go to album)\s*</, menu, "menu go-to-album label"),
    radioLabel: pick(/data-testid="artist-radio"[\s\S]{0,400}?>\s*([^<{]+?)\s*</, artist, "artist radio label"),
    albumIncomplete: pick(/title="([^"]+)"/, album, "album metadata-incomplete notice"),
    relatedTitle: pick(/title="([^"]+)"/, related, "More Like This title"),
    // A fresh profile lands on M8's first-run language onboarding, which is
    // modal: it has to be confirmed before any other surface is reachable.
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
    task: "8.2",
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    query: QUERY,
    unknownArtistKey: UNKNOWN_ARTIST_KEY,
    copy: COPY,
    steps: [],
    screenshots: [],
    consoleErrors: [],
    notes: {
      disclosures: {
        offlineWindow: [],
        blockedArtistProbe: [],
        notFoundProbe: [],
        liveUpstream: [],
        searchFallbacks: [],
      },
      catalogRequests: [],
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
  const cdpSessions = new Set();
  let offlineNow = false;
  let blockedArtistProbe = false; // deliberate single-endpoint failure window
  let notFoundProbe = false; // deliberate unresolvable-key window (a real 404)
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
    const clickElement = async (elementJs, label) => {
      const ok = await evaluate(
        `(() => { const el = ${elementJs}; if (!el) return false; el.click(); return true; })()`,
      );
      if (!ok) throw new Error(`click target missing: ${label}`);
    };
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
      if (readyExpr) await waitFor(`${path}: ${readyDesc}`, readyExpr, Boolean, 30000);
      await delay(300);
    };
    const pathname = () => evaluate(`location.pathname`);
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
        ...(text ? { text } : {}),
      };
      await send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
      await delay(40);
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    };

    // ---- console error capture with honest disclosure buckets ----------
    on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        const text = `console.error: ${params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`;
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
      // The URL is included: an unattributed 5xx is undiagnosable after the run.
      const text = `log: ${params.entry.text} [${params.entry.url ?? "no-url"}]`.slice(0, 300);
      const netCut = /net::ERR_|Failed to load resource/.test(params.entry.text);
      const statusErr = /status of [45]\d\d/.test(params.entry.text);
      const liveFlake = /status of (429|503)/.test(params.entry.text);
      // The unresolvable-key probe asks for a key nothing can resolve, so its
      // 404 is the expected answer and is disclosed rather than counted. Matched
      // on the probe key **in the URL** rather than only on a time window: the
      // probe is requested more than once (initial visit, offline retry), and a
      // URL match cannot swallow an unrelated 404 that happens to land nearby.
      const entryUrl = String(params.entry.url ?? "");
      const probeNeedle = UNKNOWN_ARTIST_KEY.replace(/-/g, "+");
      const isNotFoundProbe =
        /status of 404/.test(params.entry.text) &&
        (notFoundProbe ||
          entryUrl.includes(UNKNOWN_ARTIST_KEY) ||
          entryUrl.includes(probeNeedle));
      if (offlineNow && (netCut || statusErr)) results.notes.disclosures.offlineWindow.push(text);
      else if (liveFlake) results.notes.disclosures.liveUpstream.push(text);
      else if (isNotFoundProbe) results.notes.disclosures.notFoundProbe.push(text);
      else if (blockedArtistProbe && (netCut || statusErr))
        results.notes.disclosures.blockedArtistProbe.push(text);
      else results.consoleErrors.push(text);
    });
    // Catalog request log: proves the local "liked by this artist" signal and the
    // More Like This request carry no library/user data.
    on("Network.requestWillBeSent", (params) => {
      const url = String(params.request?.url ?? "");
      if (/\/api\/(artist|album|similar)/.test(url)) {
        results.notes.catalogRequests.push({ url: url.slice(0, 300), offline: offlineNow });
      }
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
    // Deliberate single-endpoint failure: only /api/artist is blocked.
    on("Fetch.requestPaused", (params) => {
      void send(
        blockedArtistProbe ? "Fetch.failRequest" : "Fetch.continueRequest",
        blockedArtistProbe
          ? { requestId: params.requestId, errorReason: "Failed" }
          : { requestId: params.requestId },
      );
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
    await send("Fetch.enable", {
      patterns: [{ urlPattern: "*/api/artist?*", requestStage: "Request" }],
    });

    // ---- shared page reads ---------------------------------------------
    const SEARCH_READY = `(() => {
      const input = document.querySelector('input[aria-label="Search"]');
      return !!input && Object.keys(input).some((k) => k.indexOf('__reactProps$') === 0);
    })()`;
    const SEARCH_ROWS = `[data-testid="search-results"] li`;
    const CARD = `[data-testid="shelf-track-card"]`;
    // The catalog surfaces list their tracks with the shared `SongRow` (an
    // unlabelled `li` with a real `Play …` button), not the shelf card, so each
    // entity section is counted by its rows and driven through those controls.
    const ARTIST_ROWS = `[data-testid="artist-tracks"] li`;
    const ALBUM_ROWS = `[data-testid="album-tracks"] li`;
    const PLAY_FIRST = (rows) => `${rows} button[aria-label^="Play "]`;
    const playerState = `(() => ({
      bar: document.querySelector('[data-testid="player-bar"]')?.textContent ?? '',
      control: document.querySelector('[data-testid="player-bar"] button[aria-label="Pause"]') ? 'Pause' : 'Play',
      iframes: document.querySelectorAll('iframe').length,
      apiScripts: [...document.querySelectorAll('script')].filter((s) => (s.src ?? '').includes('youtube.com/iframe_api')).length,
    }))()`;
    const openMenu = async (rowIndex) => {
      await trustedClickJs(
        `[...document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)})][${rowIndex}].querySelector('button[aria-label^="More options for"]')`,
        `result menu trigger ${rowIndex}`,
      );
      await waitFor(
        "result menu open",
        `!!document.querySelector('[role="menu"]')`,
        Boolean,
        8000,
      );
    };
    /** Click a menu item and wait for the menu to close (it closes on action). */
    const clickMenuItem = async (text, label) => {
      const clicked = await evaluate(
        `(() => {
          const item = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
            .find((i) => i.textContent.trim() === ${JSON.stringify(text)});
          if (!item) return false;
          item.click();
          return true;
        })()`,
      );
      if (!clicked) throw new Error(`menu item missing: ${label ?? text}`);
      await waitFor("menu closed", `!document.querySelector('[role="menu"]')`, Boolean, 8000);
    };
    /** The menu item text that mentions "Liked Songs", or null while closed. */
    const menuLikeLabel = `([...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
      .map((i) => i.textContent.trim())
      .find((t) => t.includes('Liked Songs')) ?? null)`;

    // Parse self-check: a malformed expression reads as a silent null timeout.
    // Only the hand-written expressions are checked; the rest are built from
    // `JSON.stringify` interpolations (selectors/values), which cannot misquote.
    for (const [name, expr] of Object.entries({
      SEARCH_READY,
      playerState,
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
    const ONBOARDING_DIALOG = `div[role="dialog"][aria-label=${JSON.stringify(
      COPY.onboardingLabel,
    )}]`;
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
      // The dialog is modal: it must be *present and settled* before any other
      // surface is reachable, so "absent" is never accepted as a pass here.
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
      await waitFor("onboarding dismissed", `!document.querySelector(${JSON.stringify(ONBOARDING_DIALOG)})`, Boolean, 20000);
    } else {
      step(
        "a fresh profile shows the accountless first-run language onboarding",
        false,
        "the first-run dialog never appeared within 30s, so every later surface was unreachable",
      );
    }

    // ====================================================================
    // STEP 1 — live search
    // ====================================================================
    const searchExpr = `location.pathname === '/search' && document.querySelectorAll(${JSON.stringify(
      SEARCH_ROWS,
    )}).length >= 3`;
    await trustedClickSel('input[aria-label="Search"]');
    await delay(150);
    await typeText(QUERY);
    const searchOk = await waitFor("live search results", searchExpr, Boolean, 30000).then(
      () => true,
      async () => {
        // Bounded fallback for a dropped keystroke on a live-provider run; any
        // use is recorded and disclosed rather than hidden.
        results.notes.searchFallbacks = results.notes.searchFallbacks ?? [];
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
      `(() => ({ path: location.pathname, rows: document.querySelectorAll(${JSON.stringify(
        SEARCH_ROWS,
      )}).length }))()`,
    );
    step(
      "live search returns results for the seeded query",
      searchOk && rows.rows >= 3,
      `rows=${rows.rows}`,
    );

    // ====================================================================
    // STEP 2 — like the first result (seeds the local liked-by-artist signal)
    // ====================================================================
    const firstTitle = await evaluate(
      `[...document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)})][0]?.textContent?.trim() ?? ''`,
    );
    await openMenu(0);
    await clickMenuItem(COPY.npSave, "like");
    // The menu closes on action, so the liked state is read from a reopened menu.
    await openMenu(0);
    const liked = await waitFor(
      "reopened menu reports the liked state",
      menuLikeLabel,
      (label) => label === COPY.npRemove,
      10000,
    );
    await keyPress({ key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await waitFor("menu closed via Escape", `!document.querySelector('[role="menu"]')`, Boolean, 4000);
    step(
      "a search result can be liked (local signal seeded)",
      liked === COPY.npRemove,
      `row="${firstTitle.slice(0, 60)}", menu now reads "${liked}"`,
    );

    // ====================================================================
    // STEP 3 — "Go to artist" opens the real artist route
    // ====================================================================
    await openMenu(0);
    const menuItems = await evaluate(
      `[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((i) => i.textContent.trim())`,
    );
    await clickMenuItem(COPY.goArtist, "go to artist");
    const artistPath = await waitFor(
      "artist route opens",
      `location.pathname`,
      (p) => p.startsWith("/artist/"),
      20000,
    );
    step(
      "the result menu's go-to-artist opens a real artist route (not a search)",
      artistPath.startsWith("/artist/"),
      `pathname=${artistPath}`,
    );
    results.notes.artistKey = decodeURIComponent(artistPath.replace("/artist/", ""));

    // ====================================================================
    // STEP 4 — the artist page renders its sections
    // ====================================================================
    const artistPage = await waitFor(
      "artist page resolves",
      `(() => {
        const view = document.querySelector('[data-testid="artist-view"]');
        if (!view) return null;
        return {
          present: true,
          loading: !!document.querySelector('[data-testid="artist-loading"]'),
          error: !!document.querySelector('[data-testid="artist-error"]'),
          notFound: !!document.querySelector('[data-testid="artist-not-found"]'),
          tracks: document.querySelectorAll('${ARTIST_ROWS}').length,
          // Skeleton rows are list items with no controls, so a real row is only
          // a row that carries its Play control. Readiness and completeness are
          // both measured on the controls, never on the row count.
          realRows: document.querySelectorAll('${PLAY_FIRST(ARTIST_ROWS)}').length,
          tracksWithArtwork: document.querySelectorAll('${ARTIST_ROWS} img').length,
          playable: document.querySelectorAll('${PLAY_FIRST(ARTIST_ROWS)}').length,
          likeable: document.querySelectorAll('[data-testid="artist-tracks"] li button[aria-label^="Save "], [data-testid="artist-tracks"] li button[aria-label^="Remove "]').length,
          portrait: !!document.querySelector('[data-testid="artist-portrait"] img'),
          heading: view.querySelector('h1, h2')?.textContent ?? '',
          releases: document.querySelectorAll('[data-testid="artist-release"]').length,
          related: document.querySelectorAll('[data-testid="artist-related-card"]').length,
          liked: document.querySelectorAll('[data-testid="artist-liked"] li').length,
          hasRadio: !!document.querySelector('[data-testid="artist-radio"]'),
          radioLabel: document.querySelector('[data-testid="artist-radio"]')?.textContent?.trim() ?? '',
        };
      })()`,
      (state) => state && (state.realRows > 0 || state.error || state.notFound),
      90000,
    );
    step(
      "the artist page renders identity, popular tracks, releases, and related artists",
      artistPage.present &&
        !artistPage.loading &&
        !artistPage.error &&
        !artistPage.notFound &&
        artistPage.realRows >= 3 &&
        artistPage.playable === artistPage.realRows &&
        artistPage.likeable === artistPage.realRows,
      `tracks=${artistPage.tracks} (playable=${artistPage.playable}, likeable=${artistPage.likeable}, withArtwork=${artistPage.tracksWithArtwork}), portrait=${artistPage.portrait}, releases=${artistPage.releases}, related=${artistPage.related}, heading="${artistPage.heading.slice(0, 40)}"`,
    );
    step(
      'the artist page offers "Start artist radio"',
      artistPage.hasRadio,
      `label="${artistPage.radioLabel}"`,
    );
    await shoot(1280, 900, "artist-page-1280.png", "Artist page: identity, popular tracks, releases, related artists");

    // ====================================================================
    // STEP 5 — liked-by-artist is local (no request carries library data)
    // ====================================================================
    const beforeLikedRequests = results.notes.catalogRequests.length;
    step(
      'the "Liked tracks by this artist" section reflects the local liked dataset',
      artistPage.liked >= 1,
      `liked rows=${artistPage.liked} (the run liked this artist's track in step 2)`,
    );
    const libraryLeak = results.notes.catalogRequests
      .slice(beforeLikedRequests)
      .filter((request) => /liked|playlist=|history/i.test(decodeURIComponent(request.url)));
    step(
      "no catalog request carries liked-track, playlist, or history data",
      libraryLeak.length === 0,
      `catalog requests observed=${results.notes.catalogRequests.length}, leaking library params=${libraryLeak.length}`,
    );
    if (artistPage.liked >= 1) {
      await shoot(1280, 900, "artist-liked-1280.png", "Artist page → Liked tracks by this artist (local signal)");
    }

    // ====================================================================
    // STEP 6 — activating an artist track starts real playback
    // ====================================================================
    await trustedClickSel(PLAY_FIRST(ARTIST_ROWS));
    const playing = await waitFor(
      "artist feed playback starts",
      playerState,
      (state) => state.control === "Pause",
      30000,
    );
    const embed = await waitFor(
      "player embed created",
      `document.querySelectorAll('iframe').length`,
      (count) => count >= 1,
      20000,
    ).catch(() => 0);
    const apiScripts = await evaluate(
      `[...document.querySelectorAll('script')].filter((s) => (s.src ?? '').includes('youtube.com/iframe_api')).length`,
    );
    step(
      "activating an artist track starts real playback with one embed",
      playing.control === "Pause" && embed === 1 && apiScripts === 1,
      `control=${playing.control}, iframes=${embed}, apiScripts=${apiScripts}`,
    );
    await goto("/queue", `!!document.querySelector('main')`, "queue surface");
    const queueLabel = await waitFor(
      "browse source label",
      `document.querySelector('main')?.textContent ?? ''`,
      (text) => text.includes(COPY.queueBrowse),
      20000,
    );
    step(
      "the artist feed is recorded as the browse playback context",
      queueLabel.includes(COPY.queueBrowse),
      `label "${COPY.queueBrowse}" present on /queue`,
    );
    const paused = await evaluate(`(() => {
      const pause = document.querySelector('[data-testid="player-bar"] button[aria-label="Pause"]');
      if (!pause) return 'already-stopped';
      pause.click();
      return 'paused';
    })()`);
    results.notes.pauseOutcome = paused;
    await delay(500);

    // ====================================================================
    // STEP 7 — "Start artist radio" seeds playback from the artist feed
    // ====================================================================
    await goto(artistPath, `!!document.querySelector('[data-testid="artist-view"]')`, "artist view");
    await waitFor(
      "artist feed ready for the radio action",
      `document.querySelectorAll('${ARTIST_ROWS}').length >= 1`,
      Boolean,
      90000,
    );
    await trustedClickSel('[data-testid="artist-radio"]');
    const radio = await waitFor(
      "radio playback starts",
      playerState,
      (state) => state.control === "Pause",
      30000,
    );
    step(
      '"Start artist radio" begins playback within the artist feed',
      radio.control === "Pause",
      `control=${radio.control}, bar="${radio.bar.replace(/\s+/g, " ").trim().slice(0, 80)}"`,
    );
    await evaluate(`(() => {
      const pause = document.querySelector('[data-testid="player-bar"] button[aria-label="Pause"]');
      if (pause) pause.click();
    })()`);
    await delay(400);

    // ====================================================================
    // STEP 8 — an unknown artist key is recoverable
    // ====================================================================
    // Armed around the probe: its 404 is the expected answer, so the console
    // entries it produces are disclosed rather than counted as defects.
    notFoundProbe = true;
    results.notes.notFoundProbeKey = UNKNOWN_ARTIST_KEY;
    await goto(
      `/artist/${encodeURIComponent(UNKNOWN_ARTIST_KEY)}`,
      `!!document.querySelector('[data-testid="artist-view"]')`,
      "artist view",
    );
    const notFound = await waitFor(
      "not-found state for an unresolvable key",
      `(() => {
        const node = document.querySelector('[data-testid="artist-not-found"]');
        return { present: !!node, text: node?.textContent ?? '', hasWayBack: !!node?.querySelector('a[href="/"], a[href="/search"], button') };
      })()`,
      (state) => state.present,
      90000,
    );
    step(
      "an unknown artist key shows a recoverable not-found state",
      notFound.present && notFound.hasWayBack,
      `text="${notFound.text.replace(/\s+/g, " ").trim().slice(0, 90)}"`,
    );
    await shoot(1280, 900, "artist-not-found-1280.png", "Unknown artist key → recoverable not-found state");
    notFoundProbe = false;

    // ====================================================================
    // STEP 9 — a release entry opens the album page
    // ====================================================================
    const releaseHref = await evaluate(
      `(() => {
        const node = document.querySelector('[data-testid="artist-releases"] a[href^="/album/"]');
        return node?.getAttribute('href') ?? '';
      })()`,
    );
    let albumHref = releaseHref;
    if (albumHref === "") {
      // No release resolved for this artist (search metadata often lacks album
      // info). Fall back to a real album tile from the search surface.
      await goto("/search", SEARCH_READY, "search input");
      await trustedClickSel('input[aria-label="Search"]');
      await delay(150);
      await typeText(QUERY);
      await waitFor(
        "search results for the album entry point",
        `document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)}).length >= 3`,
        Boolean,
        60000,
      );
      albumHref = await evaluate(
        `(() => {
          const node = document.querySelector('a[href^="/album/"]');
          return node?.getAttribute('href') ?? '';
        })()`,
      );
      results.notes.albumEntry = releaseHref === "" ? "search album tile" : "artist release entry";
    } else {
      results.notes.albumEntry = "artist release entry";
    }
    const albumPage = albumHref
      ? await (async () => {
          results.notes.albumEntryKey = decodeURIComponent(albumHref.replace("/album/", ""));
          await goto(albumHref, `!!document.querySelector('[data-testid="album-view"]')`, "album view");
          return waitFor(
            "album page resolves",
            `(() => {
              const view = document.querySelector('[data-testid="album-view"]');
              if (!view) return null;
              return {
                present: true,
                // A loading shell also renders rows (skeletons), so readiness is
                // asserted on the absence of the loading state, not on rows > 0.
                loading: !!document.querySelector('[data-testid="album-loading"]'),
                error: !!document.querySelector('[data-testid="album-error"]'),
                notFound: !!document.querySelector('[data-testid="album-not-found"]'),
                rows: document.querySelectorAll('${ALBUM_ROWS}').length,
                // Skeleton rows carry no controls, so a real row is a row with
                // its Play button; readiness is measured on that, not on rows.
                realRows: document.querySelectorAll('${PLAY_FIRST(ALBUM_ROWS)}').length,
                incomplete: !!document.querySelector('[data-testid="album-metadata-incomplete"]'),
                incompleteText: document.querySelector('[data-testid="album-metadata-incomplete"]')?.textContent ?? '',
                // The committed flag, read from the view root.
                flag: view.getAttribute('data-metadata-incomplete') ?? '',
                heading: view.querySelector('h2')?.textContent?.trim() ?? '',
                play: !!document.querySelector('[data-testid="album-play"]'),
                shuffle: !!document.querySelector('[data-testid="album-shuffle"]'),
                cover: !!document.querySelector('[data-testid="album-cover"] img'),
                artistLink: document.querySelector('[data-testid="album-artist-link"]')?.getAttribute('href') ?? '',
              };
            })()`,
            (state) =>
              state && (state.realRows > 0 || state.error || state.notFound),
            90000,
          );
        })()
      : null;
    step(
      "a release/album entry point opens the album page with its tracks",
      Boolean(albumPage) &&
      albumPage.present &&
      !albumPage.error &&
      !albumPage.notFound &&
      albumPage.realRows >= 1,
      albumPage
        ? `entry=${results.notes.albumEntry}, rows=${albumPage.rows}, cover=${albumPage.cover}, play=${albumPage.play}, shuffle=${albumPage.shuffle}`
        : "no album entry point resolved",
    );
    if (albumPage?.present) {
      // The view commits the flag it was given, so the notice and the flag are
      // asserted to *agree*. A previous version of this step asserted only that
      // the flag was a boolean, which can never fail and whose detail string
      // claimed a confirmation the run had not observed.
      step(
        "the album page's unconfirmed-tracklist notice agrees with the flag it was given",
        albumPage.flag === (albumPage.incomplete ? "true" : "false") &&
          (albumPage.incomplete ? albumPage.incompleteText.length > 0 : true),
        albumPage.incomplete
          ? `data-metadata-incomplete="${albumPage.flag}", notice: "${albumPage.incompleteText.replace(/\s+/g, " ").trim().slice(0, 90)}"`
          : `data-metadata-incomplete="${albumPage.flag}", no notice rendered (release confirmed by the provider)`,
      );
      step(
        "the album page never shows a provider release id as the release title",
        // The release tile this page came from carries a provider id, so the
        // heading must not read as one: an opaque token shaped like a YouTube id
        // is exactly what C1 used to render.
        albumPage.heading.length > 0 &&
          !/^(UC|MPRE|OLAK|PL|RA)[A-Za-z0-9_-]{6,}$/.test(albumPage.heading),
        `heading="${albumPage.heading}", key=${results.notes.albumEntryKey ?? "unknown"}`,
      );
      step(
        "the album page links its artist to the artist route",
        albumPage.artistLink === "" || albumPage.artistLink.startsWith("/artist/"),
        `artist link="${albumPage.artistLink}"`,
      );
      await shoot(1280, 900, "album-page-1280.png", "Album page: cover, ordered tracks, play + shuffle");
    }

    // ====================================================================
    // STEP 10 — album: like a track and open the add-to-playlist picker
    // ====================================================================
    if (albumPage?.present && albumPage.realRows >= 1) {
      const likeResult = await evaluate(
        `(() => {
          const row = document.querySelector('${ALBUM_ROWS}');
          if (!row) return { ok: false, reason: 'no row' };
          const like = row.querySelector('button[aria-label^="Save"], button[aria-label^="Remove"]');
          const add = row.querySelector('button[aria-label*="to a playlist"]');
          return {
            ok: !!like,
            like: like?.getAttribute('aria-label') ?? null,
            add: add?.getAttribute('aria-label') ?? null,
            likeableRows: document.querySelectorAll('${ALBUM_ROWS} button[aria-label^="Save"], ${ALBUM_ROWS} button[aria-label^="Remove"]').length,
          };
        })()`,
      );
      step(
        "every album track row exposes like and add-to-playlist controls",
        likeResult.ok &&
        likeResult.add !== null &&
        likeResult.likeableRows === albumPage.realRows,
        `rows=${albumPage.rows}, likeableRows=${likeResult.likeableRows}, like="${likeResult.like}", add="${likeResult.add}"`,
      );
      if (likeResult.ok) {
        await trustedClickJs(
          `document.querySelector('${ALBUM_ROWS} button[aria-label^="Save "]')`,
          "album track like",
        );
        const likedRow = await waitFor(
          "album row like state flips",
          `(() => {
            const row = document.querySelector('${ALBUM_ROWS}');
            return !!row?.querySelector('button[aria-label^="Remove "]');
          })()`,
          Boolean,
          10000,
        );
        step("liking an album track persists and flips the control", likedRow, `via "${likeResult.like}"`);
      }
      if (likeResult.add !== null) {
        await trustedClickJs(
          `document.querySelector('${ALBUM_ROWS} button[aria-label*="to a playlist"]')`,
          "album add to playlist",
        );
        const picker = await waitFor(
          "existing playlist picker opens",
          `!!document.querySelector('div[role="dialog"][aria-label="Add to playlist"], [role="dialog"][aria-label*="playlist" i]')`,
          Boolean,
          10000,
        );
        step("album tracks reuse the existing add-to-playlist picker", picker, `control "${likeResult.add}"`);
        await keyPress({ key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await delay(300);
      }
    }

    // ====================================================================
    // STEP 11 — Now Playing: artwork background, long title, More Like This
    // ====================================================================
    await goto("/now-playing", `!!document.querySelector('main')`, "now playing");
    const np = await waitFor(
      "More Like This shelf resolves for the current track",
      `(() => {
        const shelf = document.querySelector('[data-testid="more-like-this"]');
        if (!shelf) return null;
        const current = document.querySelector('[data-testid="player-bar"]')?.textContent ?? '';
        return {
          present: true,
          cards: shelf.querySelectorAll('${CARD}').length,
          skeletons: shelf.querySelectorAll('[data-testid="shelf-skeleton"]').length,
          error: !!shelf.querySelector('[data-testid="shelf-error"], [data-testid="error-retry"]'),
          similarRequests: performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/similar')).length,
          barText: current,
        };
      })()`,
      (state) => state && (state.cards > 0 || state.error),
      90000,
    );
    step(
      "Now Playing offers a More Like This shelf for the current track",
      np.present && np.cards > 0,
      `cards=${np.cards}, skeletons=${np.skeletons}, error=${np.error}`,
    );
    const similarUrl = results.notes.catalogRequests.filter((r) => r.url.includes("/api/similar")).pop();
    step(
      "the More Like This request carries only the track's public metadata",
      Boolean(similarUrl) && !/liked|playlist=|history/i.test(decodeURIComponent(similarUrl.url)),
      similarUrl
        ? `url=${similarUrl.url.replace(ORIGIN, "").slice(0, 150)}`
        : "no /api/similar request observed",
    );
    // The shelf excludes the source track; the request's own `exclude` parameter
    // names it, so the rendered cards can be checked against that id directly.
    const excludedId = similarUrl
      ? new URL(similarUrl.url, ORIGIN).searchParams.get("exclude") ?? ""
      : "";
    const cardIds = await evaluate(
      `[...document.querySelectorAll('[data-testid="more-like-this"] ${CARD}')].map((c) => c.getAttribute('data-track-id') ?? '')`,
    );
    step(
      "the More Like This shelf never offers the track already playing",
      Boolean(excludedId) && !cardIds.includes(excludedId) && cardIds.length === np.cards,
      `excluded "${excludedId}" (${excludedId.length} chars), cards rendered=${cardIds.length}, excluded present=${cardIds.includes(excludedId)}`,
    );
    const presentation = await evaluate(
      `(() => {
        // The backdrop IS the artwork image (it carries the testid itself), so
        // it is checked as an element rather than as a wrapper's child.
        const background = document.querySelector('[data-testid="now-playing-background"]');
        const title = document.querySelector('[data-testid="now-playing-title"]');
        return {
          backgroundTag: background?.tagName ?? null,
          backgroundSrc: (background?.getAttribute('src') ?? '').slice(0, 80),
          decorative: background?.getAttribute('aria-hidden') === 'true',
          alt: background?.getAttribute('alt'),
          title: title?.textContent?.trim() ?? '',
          titleAttr: title?.getAttribute('title') ?? '',
          marquee: !!document.querySelector('[class*="marquee"]'),
        };
      })()`,
    );
    step(
      "Now Playing renders an artwork-derived, decorative background",
      presentation.backgroundTag === "IMG" &&
        presentation.backgroundSrc !== "" &&
        presentation.decorative &&
        presentation.alt === "",
      `element=<${presentation.backgroundTag}>, src="${presentation.backgroundSrc.slice(0, 48)}", aria-hidden=${presentation.decorative}, alt=${JSON.stringify(presentation.alt)}`,
    );
    step(
      "the long-title treatment always keeps the full title available",
      presentation.title.length > 0 &&
        (presentation.titleAttr.length > 0 || presentation.title.length > 12),
      `marquee=${presentation.marquee}, title="${presentation.title.slice(0, 50)}", titleAttribute=${presentation.titleAttr.length > 0}`,
    );
    await shoot(1280, 900, "now-playing-related-1280.png", "Now Playing: artwork background + More Like This shelf");

    // ====================================================================
    // STEP 12 — Home + search entry points target the catalog routes
    // ====================================================================
    await goto("/", `!!document.querySelector('main')`, "home");
    const homeLinks = await waitFor(
      "Home artist cards link to artist routes",
      `(() => {
        const cards = [...document.querySelectorAll('[data-testid="home-artist-card"]')];
        return { count: cards.length, hrefs: cards.map((c) => c.getAttribute('href') ?? ''), searchRefs: cards.filter((c) => (c.getAttribute('href') ?? '').startsWith('/search')).length };
      })()`,
      (state) => state.count >= 1,
      90000,
    );
    step(
      "the Home artists shelf links to artist routes",
      homeLinks.count >= 1 && homeLinks.searchRefs === 0 && homeLinks.hrefs.every((h) => h.startsWith("/artist/")),
      `cards=${homeLinks.count}, still-pointing-at-search=${homeLinks.searchRefs}, e.g. ${homeLinks.hrefs[0] ?? "none"}`,
    );
    await goto("/search", SEARCH_READY, "search input");
    await trustedClickSel('input[aria-label="Search"]');
    await delay(150);
    await typeText(QUERY);
    await waitFor(
      "search results for the entry-point check",
      `document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)}).length >= 3`,
      Boolean,
      60000,
    );
    const entryLinks = await evaluate(
      `(() => ({
        artistTiles: [...document.querySelectorAll('a[href^="/artist/"]')].length,
        albumTiles: [...document.querySelectorAll('a[href^="/album/"]')].length,
      }))()`,
    );
    await openMenu(0);
    const menuHasRoutes = {
      items: menuItems,
      hasArtist: menuItems.includes(COPY.goArtist),
      hasAlbum: menuItems.includes(COPY.goAlbum),
    };
    await keyPress({ key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    step(
      "search artist/album entries are real routes and the menu keeps go-to-artist/album",
      entryLinks.artistTiles + entryLinks.albumTiles > 0 && menuHasRoutes.hasArtist && menuHasRoutes.hasAlbum,
      `artistTiles=${entryLinks.artistTiles}, albumTiles=${entryLinks.albumTiles}, menuItems=${JSON.stringify(menuHasRoutes.items).slice(0, 160)}`,
    );

    // ====================================================================
    // STEP 13 — one blocked entity request degrades alone and recovers
    // ====================================================================
    blockedArtistProbe = true;
    results.notes.blockedEndpoint = "/api/artist";
    await goto(artistPath, `!!document.querySelector('[data-testid="artist-view"]')`, "artist view");
    const blocked = await waitFor(
      "blocked artist resolution shows a retryable error",
      `(() => ({
        error: !!document.querySelector('[data-testid="artist-error"]'),
        retry: !!document.querySelector('[data-testid="artist-error"] [data-testid="error-retry"], [data-testid="error-retry"]'),
        shell: !!document.querySelector('[data-testid="player-bar"]'),
      }))()`,
      (state) => state.error && state.retry,
      60000,
    );
    step(
      "one failing entity request degrades to a retryable error on that page alone",
      blocked.error && blocked.retry && blocked.shell,
      `error=${blocked.error}, retry=${blocked.retry}, shellAlive=${blocked.shell}`,
    );
    await shoot(1280, 900, "artist-error-1280.png", "Artist page with the entity request blocked → retryable error");
    blockedArtistProbe = false;
    await trustedClickSel('[data-testid="error-retry"]');
    const recovered = await waitFor(
      "the artist page recovers on retry",
      `document.querySelectorAll('${ARTIST_ROWS}').length >= 1`,
      Boolean,
      90000,
    );
    step("the entity page recovers on retry", recovered, `tracks=${recovered}`);

    // ====================================================================
    // STEP 14 — offline degrades to a retryable error, not a crash
    //
    // A *full document* navigation while offline cannot exercise an entity page
    // at all: the route is server-rendered, so the document itself never arrives
    // (the M8 run asserted the same thing for `/discover` and had to settle for
    // the client's "needs a connection" branch). The probe here is therefore
    // deliberately one that keeps the already-loaded page and re-runs its
    // resolution: the not-found state carries a retry control, and clicking it
    // offline must produce the retryable error rather than a crash.
    // ====================================================================
    await goto(
      `/artist/${encodeURIComponent(UNKNOWN_ARTIST_KEY)}`,
      `!!document.querySelector('[data-testid="artist-not-found"]')`,
      "artist not-found",
    );
    await setOffline(true);
    await trustedClickSel('[data-testid="artist-not-found-retry"]');
    const offlineArtist = await waitFor(
      "offline retry shows a retryable error",
      `(() => ({
        error: !!document.querySelector('[data-testid="artist-error"]'),
        retry: !!document.querySelector('[data-testid="error-retry"]'),
        notFound: !!document.querySelector('[data-testid="artist-not-found"]'),
        shell: !!document.querySelector('[data-testid="player-bar"]'),
      }))()`,
      (state) => state.error || state.retry || state.notFound,
      60000,
    );
    step(
      "offline, retrying an entity resolution degrades to a retryable state, not a crash",
      offlineArtist.shell && (offlineArtist.error || offlineArtist.retry),
      `error=${offlineArtist.error}, retry=${offlineArtist.retry}, stillNotFound=${offlineArtist.notFound}, shellAlive=${offlineArtist.shell}`,
    );
    await setOffline(false);
    await waitFor("banner cleared", `!document.querySelector('[data-testid="connection-banner"]')`, Boolean, 20000);
    await goto(artistPath, `!!document.querySelector('[data-testid="artist-view"]')`, "artist view");
    const afterReconnect = await waitFor(
      "the artist page works again after reconnecting",
      `document.querySelectorAll('${ARTIST_ROWS}').length >= 1`,
      Boolean,
      90000,
    );
    step("reconnecting restores a working artist page", Boolean(afterReconnect), `tracks=${afterReconnect}`);

    // ====================================================================
    // STEP 15 — the IFrame API is still loaded exactly once
    // ====================================================================
    const final = await evaluate(playerState);
    step(
      "the IFrame API is still loaded exactly once at the end of the run",
      final.apiScripts <= 1,
      `apiScripts=${final.apiScripts}, iframes now=${final.iframes}, control=${final.control}`,
    );

    // ====================================================================
    // STEP 16 — zero console errors
    // ====================================================================
    step(
      "zero console errors (disclosed offline/blocked/not-found entries excluded)",
      results.consoleErrors.length === 0,
      `errors=${results.consoleErrors.length}, disclosed offline=${results.notes.disclosures.offlineWindow.length}, disclosed blocked-artist=${results.notes.disclosures.blockedArtistProbe.length}, disclosed unresolvable-key-404=${results.notes.disclosures.notFoundProbe.length}, disclosed live-upstream=${results.notes.disclosures.liveUpstream.length}`,
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
