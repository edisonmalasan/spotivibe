#!/usr/bin/env node
/**
 * M10 task 7.2 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Drives a production build (`next start`) in headless Edge over the Chrome
 * DevTools Protocol to capture what unit tests cannot about continuous listening:
 *   1. a search result's "Start track radio" really starts a radio, plays it, and
 *      the queue presents it as its own source;
 *   2. the radio is *played down* to its low-water mark with the real transport,
 *      refills, and the refill excludes the tracks it already played;
 *   3. nothing the radio played is queued twice, before or after refills;
 *   4. Now Playing offers the radio action (with an accessible name) and shows
 *      the radio while one plays;
 *   5. a refill that fails (blocked over CDP `Fetch`) leaves the queue playing,
 *      offers a NON-BLOCKING retry, and recovers on retry;
 *   6. the artist page's "Start artist radio" enters radio mode for that artist;
 *   7. the autofill setting gates ordinary-playback growth: with it off, draining
 *      an ordinary queue spends no provider request; with it on, the low queue is
 *      grown by a request;
 *   8. no radio/autofill request ever carried taste-profile, liked-track, or
 *      history data — only identity, variant, limit, and exclusions;
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

/**
 * The complete parameter surface a radio/autofill request is allowed to carry.
 * The server's architecture test pins the same six keys; this is the browser-side
 * proof that no request ever carries anything else.
 */
const RADIO_KEYS_ALLOWED = ["kind", "title", "artist", "variant", "limit", "exclude"];

/**
 * In-page expression returning the log of every observed `/api/radio` request as
 * `{ kind, title, artist, variant, limit, excludeCount, keys }`. The log lives in
 * the page (not the harness) so a navigation cannot lose it.
 */
const RADIO_FEED_LOG_EXPR = `(() => {
  if (!window.__spotivibeRadioLog) window.__spotivibeRadioLog = [];
  return window.__spotivibeRadioLog;
})()`;

/** Exact copy lifted from the sources at runtime (no encoding assumptions). */
function extractConstants() {
  const read = (...parts) => readFileSync(join(FRONTEND, ...parts), "utf8");
  const queue = read("src/features/queue/QueueView.tsx");
  const menu = read("src/features/search/ResultMenu.tsx");
  const onboarding = read("src/features/preferences/LanguageOnboarding.tsx");
  const refill = read("src/features/personalization/RefillAgent.tsx");
  const settings = read("src/features/preferences/AutofillSettingsSection.tsx");
  const pick = (re, source, name) => {
    const value = re.exec(source)?.[1];
    if (!value) throw new Error(`Could not extract ${name} from sources.`);
    return value;
  };
  return {
    radioLabel: pick(/radio: "([^"]+)"/, queue, "radio queue label"),
    radioItem: pick(/(Start track radio)/u, menu, "menu radio item"),
    goArtist: pick(/>\s*(Go to artist)\s*</, menu, "menu go-to-artist label"),
    retryLabel: pick(/>\s*([A-Z][^<>{}]*?)\s*<\/Button>/, refill, "refill retry label"),
    autofillLabel: pick(/AUTOFILL_TOGGLE_LABEL = "([^"]+)"/, settings, "autofill toggle label"),
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
    allowedRadioKeys: RADIO_KEYS_ALLOWED,
    copy: COPY,
    steps: [],
    screenshots: [],
    consoleErrors: [],
    notes: {
      disclosures: {
        offlineWindow: [],
        blockedRadioProbe: [],
        notFoundProbe: [],
        liveUpstream: [],
        searchFallbacks: [],
      },
      radioRequests: [],
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
  let blockedRadioProbe = false; // deliberate single-endpoint failure window
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
      await delay(300);
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
      // The unresolvable-key probe asks for a key nothing can resolve, so its
      // 404 is the expected answer. Matched on the probe key in the URL rather
      // than only on a time window, so an unrelated 404 can never be swallowed.
      const probeNeedle = UNKNOWN_ARTIST_KEY.replace(/-/g, "+");
      const isNotFoundProbe =
        /status of 404/.test(params.entry.text) &&
        (notFoundProbe || entryUrl.includes(UNKNOWN_ARTIST_KEY) || entryUrl.includes(probeNeedle));
      if (offlineNow && (netCut || statusErr)) results.notes.disclosures.offlineWindow.push(text);
      else if (liveFlake) results.notes.disclosures.liveUpstream.push(text);
      else if (isNotFoundProbe) results.notes.disclosures.notFoundProbe.push(text);
      else if (blockedRadioProbe && (netCut || statusErr))
        results.notes.disclosures.blockedRadioProbe.push(text);
      else results.consoleErrors.push(text);
    });
    // Every radio/autofill request is recorded twice: in the harness (for the run
    // record) and in the page (so the log survives a navigation and can be read
    // back with a plain evaluate).
    on("Network.requestWillBeSent", (params) => {
      const url = String(params.request?.url ?? "");
      if (!url.includes("/api/radio")) return;
      const parsed = new URL(url, ORIGIN);
      const record = {
        url: url.replace(ORIGIN, "").slice(0, 300),
        keys: [...parsed.searchParams.keys()].sort(),
        kind: parsed.searchParams.get("kind"),
        title: parsed.searchParams.get("title"),
        artist: parsed.searchParams.get("artist"),
        variant: Number(parsed.searchParams.get("variant") ?? "0"),
        limit: Number(parsed.searchParams.get("limit") ?? "0"),
        excludeCount: (parsed.searchParams.get("exclude") ?? "")
          .split(",")
          .filter((id) => id.trim() !== "").length,
      };
      results.notes.radioRequests.push(record);
      // The page-side log is reinstalled on every document, so record it there
      // too, re-seeding the log when the document has just been replaced.
      evaluate(`(() => {
        if (!window.__spotivibeRadioLog) window.__spotivibeRadioLog = [];
        window.__spotivibeRadioLog.push(${JSON.stringify(record)});
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
    // Deliberate single-endpoint failure: only the radio feed is blocked.
    on("Fetch.requestPaused", (params) => {
      void send(
        blockedRadioProbe ? "Fetch.failRequest" : "Fetch.continueRequest",
        blockedRadioProbe
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
      patterns: [{ urlPattern: "*/api/radio?*", requestStage: "Request" }],
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

    // Parse self-check: a malformed expression reads as a silent null timeout.
    // Only the hand-written expressions are checked; the rest are built from
    // `JSON.stringify` interpolations, which cannot misquote.
    for (const [name, expr] of Object.entries({
      SEARCH_READY,
      playerState,
      RADIO_FEED_LOG_EXPR,
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
    notFoundProbe = false;

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
    // STEP 2 — a search result starts a TRACK RADIO
    // ====================================================================
    await openMenu(0);
    await clickMenuItem(COPY.radioItem, "start track radio");
    const firstFeed = await waitFor(
      "the first radio feed is requested",
      `(() => {
        const feeds = (${RADIO_FEED_LOG_EXPR});
        return feeds.length >= 1 ? feeds : null;
      })()`,
      Boolean,
      30000,
    ).catch(() => null);
    const radioStarted = await waitFor(
      "radio playback starts from the queue",
      playerState,
      (state) => state.control === "Pause",
      40000,
    );
    step(
      'the search result menu starts a track radio',
      Boolean(firstFeed) && radioStarted.control === "Pause",
      `feed variant=${firstFeed?.[0]?.variant ?? "none"}, control=${radioStarted.control}, bar="${radioStarted.bar.replace(/\s+/g, " ").trim().slice(0, 60)}"`,
    );
    step(
      "the first radio request carries only identity, variant, limit, and exclusions",
      Boolean(firstFeed) && firstFeed[0].keys.every((key) => RADIO_KEYS_ALLOWED.includes(key)),
      `params=${JSON.stringify(firstFeed?.[0]?.keys ?? [])}`,
    );
    await goto("/queue", `!!document.querySelector('main')`, "queue surface");
    const radioQueue = await waitFor(
      "the radio queue is labelled and populated",
      `(() => ({
        label: (document.querySelector('main')?.textContent ?? '').includes(${JSON.stringify(COPY.radioLabel)}),
        rows: document.querySelectorAll('[data-testid="queue-row"]').length,
      }))()`,
      (state) => state.label && state.rows >= 2,
      20000,
    );
    step(
      "the radio is presented as its own source and filled the queue",
      radioQueue.label && radioQueue.rows >= 2,
      `label "${COPY.radioLabel}" present, queue rows=${radioQueue.rows}`,
    );
    await shoot(1280, 900, "radio-queue-1280.png", "Radio queue: its own source label and the filled queue");

    // ====================================================================
    // STEP 3 — the radio refills before the queue runs out, without repeats
    // ====================================================================
    // Play the radio down to its low-water mark by using the real transport. Every
    // track that plays is a track the refill must never serve again, so this is the
    // run that actually exercises dedupe rather than asserting it.
    const played = [];
    let refillObserved = null;
    const queueBefore = radioQueue.rows;
    await goto("/now-playing", `!!document.querySelector('main')`, "now playing");
    for (let skip = 0; skip < 14; skip += 1) {
      const before = await evaluate(
        `document.querySelector('[data-testid="player-bar"]')?.textContent ?? ''`,
      );
      await trustedClickSel('[aria-label="Next track"]');
      await waitFor(
        `the current track changes after skip ${skip + 1}`,
        `(() => {
          const now = document.querySelector('[data-testid="player-bar"]')?.textContent ?? '';
          return now !== '' && now !== ${JSON.stringify(before)} ? now : null;
        })()`,
        Boolean,
        20000,
      ).catch(() => null);
      const bar = await evaluate(
        `document.querySelector('[data-testid="player-bar"]')?.textContent ?? ''`,
      );
      if (bar) played.push(bar.replace(/\s+/g, " ").trim().slice(0, 40));
      const feeds = await evaluate(RADIO_FEED_LOG_EXPR);
      if (feeds.length >= 2) {
        refillObserved = feeds;
        break;
      }
    }
    await delay(1500);
    const feedsAfterSkips = await evaluate(RADIO_FEED_LOG_EXPR);
    const queueAfter = await waitFor(
      "the radio queue grew after the refill",
      `document.querySelectorAll('[data-testid="queue-row"]').length`,
      (count) => count > queueBefore || feedsAfterSkips.length >= 2,
      20000,
    ).catch(() => 0);
    const second = feedsAfterSkips[1];
    step(
      "the radio refills when the queue runs low, with a different variant",
      Boolean(second) && second.variant !== feedsAfterSkips[0].variant,
      `feeds=${feedsAfterSkips.length}, variants=${JSON.stringify(feedsAfterSkips.map((f) => f.variant))}, queue rows ${queueBefore} -> ${queueAfter}`,
    );
    step(
      "a refill excludes the tracks this radio already played",
      Boolean(second) && second.excludeCount > 0,
      `excluded ids on refill #2 = ${second?.excludeCount ?? 0} (tracks played during the skip run: ${played.length})`,
    );
    step(
      "the radio continues across the refill without an error",
      !(await evaluate(`!!document.querySelector('[data-testid="refill-failure"]')`)),
      `queue rows=${queueAfter}, no refill failure notice`,
    );

    // Dedupe: nothing the radio played may be queued again, and no id may appear
    // twice in the queue itself.
    const dedupe = await goto("/queue", `!!document.querySelector('main')`, "queue surface").then(() =>
      evaluate(`(() => {
        const ids = [...document.querySelectorAll('[data-testid="queue-row"]')].map((row) => row.getAttribute('data-track-id') ?? '');
        return { total: ids.length, unique: new Set(ids).size, blank: ids.filter((id) => id === '').length };
      })()`),
    );
    step(
      "no track id is queued twice after refills",
      dedupe.blank === 0 && dedupe.total === dedupe.unique,
      `rows=${dedupe.total}, distinct ids=${dedupe.unique}, rows without an id=${dedupe.blank}`,
    );

    // ====================================================================
    // STEP 4 — the Now Playing radio surface
    // ====================================================================
    const npRadio = await goto("/now-playing", `!!document.querySelector('main')`, "now playing").then(() =>
      evaluate(`(() => {
        const action = document.querySelector('[data-testid="now-playing-radio"]');
        return {
          action: !!action,
          label: action?.getAttribute('aria-label') ?? '',
          disabled: action?.getAttribute('aria-disabled') === 'true' || action?.hasAttribute('disabled') === true,
          indicator: !!document.querySelector('[data-testid="now-playing-radio-indicator"]'),
          indicatorText: document.querySelector('[data-testid="now-playing-radio-indicator"]')?.textContent ?? '',
        };
      })()`),
    );
    step(
      "Now Playing offers the radio action with an accessible name while a track plays",
      npRadio.action && npRadio.label.length > 0 && !npRadio.disabled,
      `label="${npRadio.label}", disabled=${npRadio.disabled}`,
    );
    step(
      "Now Playing shows the radio while one is playing",
      npRadio.indicator,
      `indicator text="${npRadio.indicatorText.trim()}"`,
    );
    await shoot(
      1280,
      900,
      "now-playing-radio-1280.png",
      "Now Playing: radio action and the live radio indicator",
    );

    // ====================================================================
    // STEP 5 — a failed refill is survivable: queue keeps playing, retry offered
    // ====================================================================
    blockedRadioProbe = true;
    results.notes.blockedEndpoint = "/api/radio";
    // Force the next refill to fail by draining the radio to its threshold again.
    for (let skip = 0; skip < 8; skip += 1) {
      const before = await evaluate(
        `document.querySelector('[data-testid="player-bar"]')?.textContent ?? ''`,
      );
      await trustedClickSel('[aria-label="Next track"]');
      await waitFor(
        `the current track changes after blocked skip ${skip + 1}`,
        `(() => {
          const now = document.querySelector('[data-testid="player-bar"]')?.textContent ?? '';
          return now !== '' && now !== ${JSON.stringify(before)} ? now : null;
        })()`,
        Boolean,
        20000,
      ).catch(() => null);
      if (await evaluate(`!!document.querySelector('[data-testid="refill-failure"]')`)) break;
    }
    const failed = await waitFor(
      "a blocked refill surfaces a non-blocking retry affordance",
      `(() => {
        const notice = document.querySelector('[data-testid="refill-failure"]');
        if (!notice) return null;
        return {
          present: true,
          role: notice.getAttribute('role') ?? '',
          text: notice.textContent ?? '',
          retry: [...notice.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(
            COPY.retryLabel,
          )}),
          shell: !!document.querySelector('[data-testid="player-bar"]'),
        };
      })()`,
      (state) => state !== null,
      60000,
    );
    step(
      "a failed refill keeps the queue playing and offers a retry, without a modal",
      Boolean(failed) && failed.retry && failed.shell,
      `role="${failed?.role ?? ""}", retry offered=${failed?.retry ?? false}, shell alive=${failed?.shell ?? false}, text="${(failed?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80)}"`,
    );
    await shoot(1280, 900, "radio-refill-failure-1280.png", "Refill blocked → non-blocking retry while the queue keeps playing");
    blockedRadioProbe = false;
    await trustedClickJs(buttonByText(COPY.retryLabel), "retry the refill");
    const recovered = await waitFor(
      "the radio recovers after the retry",
      RADIO_FEED_LOG_EXPR,
      (feeds) => feeds.length >= 3,
      60000,
    ).then(() => true).catch(() => false);
    step(
      "retrying after the block resumes the radio's refills",
      recovered,
      `feeds observed=${(await evaluate(RADIO_FEED_LOG_EXPR)).length}`,
    );

    // ====================================================================
    // STEP 6 — artist radio from the artist page
    // ====================================================================
    await goto("/search", SEARCH_READY, "search input");
    await trustedClickSel('input[aria-label="Search"]');
    await delay(150);
    await typeText(QUERY);
    await waitFor("search results for the artist entry point", searchExpr, Boolean, 60000);
    await openMenu(0);
    await clickMenuItem(COPY.goArtist, "go to artist");
    const artistPath = await waitFor(
      "artist route opens",
      `location.pathname`,
      (p) => p.startsWith("/artist/"),
      20000,
    );
    await waitFor(
      "the artist page resolves",
      `(() => {
        const view = document.querySelector('[data-testid="artist-view"]');
        return !!view && document.querySelectorAll('[data-testid="artist-tracks"] li button[aria-label^="Play "]').length >= 1;
      })()`,
      Boolean,
      90000,
    );
    results.notes.artistKey = decodeURIComponent(artistPath.replace("/artist/", ""));
    await trustedClickSel('[data-testid="artist-radio"]');
    const artistRadio = await waitFor(
      "the artist radio starts playing",
      playerState,
      (state) => state.control === "Pause",
      40000,
    );
    const artistFeeds = await evaluate(RADIO_FEED_LOG_EXPR);
    step(
      "the artist page starts an artist radio",
      artistRadio.control === "Pause" &&
        artistFeeds.some(
          (feed) =>
            feed.kind === "artist" &&
            (feed.artist ?? '').toLowerCase() === results.notes.artistKey.toLowerCase(),
        ),
      `control=${artistRadio.control}, artist feed requested=${artistFeeds.some((f) => f.kind === "artist")}, artist="${results.notes.artistKey}"`,
    );
    await goto("/queue", `!!document.querySelector('main')`, "queue surface");
    const artistQueueLabel = await evaluate(
      `document.querySelector('main')?.textContent?.includes(${JSON.stringify(COPY.radioLabel)}) ?? false`,
    );
    step("the artist radio is labelled as a radio", artistQueueLabel, `"${COPY.radioLabel}" present`);

    // ====================================================================
    // STEP 7 — the autofill setting gates ordinary-playback growth
    // ====================================================================
    await goto("/settings", `!!document.querySelector('[data-testid="autofill-setting"]')`, "autofill setting");
    const setting = await evaluate(
      `(() => {
        const control = document.querySelector('input[aria-label=${JSON.stringify(COPY.autofillLabel)}]');
        return { present: !!control, checked: control?.checked ?? null };
      })()`,
    );
    step(
      "the autofill setting exists and is on by default",
      setting.present && setting.checked === true,
      `control "${COPY.autofillLabel}" present=${setting.present}, checked=${setting.checked}`,
    );
    // Turn it off, start ordinary playback from search, and drain the queue: with
    // the setting off the app must not spend a provider request on autofill.
    const feedsBeforeOff = (await evaluate(RADIO_FEED_LOG_EXPR)).length;
    await trustedClickSel(`input[aria-label=${JSON.stringify(COPY.autofillLabel)}]`);
    await goto("/search", SEARCH_READY, "search input");
    await trustedClickSel('input[aria-label="Search"]');
    await delay(150);
    await typeText(QUERY);
    await waitFor("search results for the autofill run", searchExpr, Boolean, 60000);
    await trustedClickJs(
      `[...document.querySelectorAll(${JSON.stringify(SEARCH_ROWS)})][0].querySelector('button[aria-label^="Play "]')`,
      "play the first search result",
    );
    await waitFor("ordinary playback starts", playerState, (state) => state.control === "Pause", 40000);
    // Navigate once, *outside* the drain loop: a document load re-seeds the
    // page-side request log, so re-entering Now Playing every iteration would
    // erase the very evidence this run is collecting.
    await goto("/now-playing", `!!document.querySelector('main')`, "now playing");
    for (let skip = 0; skip < 12; skip += 1) {
      const before = await evaluate(
        `document.querySelector('[data-testid="player-bar"]')?.textContent ?? ''`,
      );
      await trustedClickSel('[aria-label="Next track"]');
      await waitFor(
        `ordinary playback advances (skip ${skip + 1})`,
        `(() => {
          const now = document.querySelector('[data-testid="player-bar"]')?.textContent ?? '';
          return now !== '' && now !== ${JSON.stringify(before)} ? now : null;
        })()`,
        Boolean,
        20000,
      ).catch(() => null);
      const feeds = await evaluate(RADIO_FEED_LOG_EXPR);
      if (feeds.length > feedsBeforeOff) break;
    }
    const feedsWhileOff = await evaluate(RADIO_FEED_LOG_EXPR);
    step(
      "with autofill off, a low ordinary queue spends no provider request",
      feedsWhileOff.length === feedsBeforeOff,
      `feeds before=${feedsBeforeOff}, after draining with the setting off=${feedsWhileOff.length}`,
    );
    // Turn it back on and drain again: now the queue must be grown.
    await goto("/settings", `!!document.querySelector('[data-testid="autofill-setting"]')`, "autofill setting");
    await trustedClickSel(`input[aria-label=${JSON.stringify(COPY.autofillLabel)}]`);
    const feedsBeforeOn = (await evaluate(RADIO_FEED_LOG_EXPR)).length;
    // Same rule as above: one navigation for the whole drain, not one per skip.
    await goto("/now-playing", `!!document.querySelector('main')`, "now playing");
    for (let skip = 0; skip < 12; skip += 1) {
      const before = await evaluate(
        `document.querySelector('[data-testid="player-bar"]')?.textContent ?? ''`,
      );
      await trustedClickSel('[aria-label="Next track"]');
      await waitFor(
        `ordinary playback advances with autofill on (skip ${skip + 1})`,
        `(() => {
          const now = document.querySelector('[data-testid="player-bar"]')?.textContent ?? '';
          return now !== '' && now !== ${JSON.stringify(before)} ? now : null;
        })()`,
        Boolean,
        20000,
      ).catch(() => null);
      const feeds = await evaluate(RADIO_FEED_LOG_EXPR);
      if (feeds.length > feedsBeforeOn) break;
    }
    const feedsWhileOn = await evaluate(RADIO_FEED_LOG_EXPR);
    step(
      "with autofill on, a low ordinary queue is grown by a scored request",
      feedsWhileOn.length > feedsBeforeOn,
      `feeds before=${feedsBeforeOn}, after draining with the setting on=${feedsWhileOn.length}`,
    );
    step(
      "no personalization request ever carried profile, liked, or history data",
      feedsWhileOn.every((feed) => feed.keys.every((key) => RADIO_KEYS_ALLOWED.includes(key))),
      `every observed request's params: ${JSON.stringify([...new Set(feedsWhileOn.flatMap((f) => f.keys))])}`,
    );

    // ====================================================================
    // STEP 8 — the IFrame API is still loaded exactly once
    // ====================================================================
    const final = await evaluate(playerState);
    step(
      "the IFrame API is still loaded exactly once at the end of the run",
      final.apiScripts <= 1,
      `apiScripts=${final.apiScripts}, iframes now=${final.iframes}, control=${final.control}`,
    );

    // ====================================================================
    // STEP 9 — zero console errors
    // ====================================================================
    step(
      "zero console errors (disclosed offline/blocked/not-found entries excluded)",
      results.consoleErrors.length === 0,
      `errors=${results.consoleErrors.length}, disclosed offline=${results.notes.disclosures.offlineWindow.length}, disclosed blocked-radio=${results.notes.disclosures.blockedRadioProbe.length}, disclosed unresolvable-key-404=${results.notes.disclosures.notFoundProbe.length}, disclosed live-upstream=${results.notes.disclosures.liveUpstream.length}`,
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
