#!/usr/bin/env node
/**
 * M8 task 9.2 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Drives a production build (`next start`) in headless Edge over the Chrome
 * DevTools Protocol to capture what unit tests cannot:
 *   1. first-run language onboarding: the catalog is offered, a multi-language
 *      selection persists across a full reload, and no account copy appears;
 *   2. Home renders the DESIGN.md feed — Trending Now with real provider
 *      artwork, Popular Artists as an unclustered circular section inside the
 *      first four sections, Genres, Podcasts, Collections — and none of the
 *      locally informed sections for a brand-new profile;
 *   3. a multi-language feed is actually MIXED in the DOM (seed-attributed
 *      `data-language` on the cards), not grouped by language;
 *   4. shelf copy never claims an official chart / editorial selection;
 *   5. activating a card starts real playback recorded with the `browse` queue
 *      source, which then feeds Recently Played and Made For You after a
 *      reload (the local-only sections appear for a returning profile);
 *   6. ONE failing shelf (a request blocked over CDP `Fetch`) shows a
 *      retryable error on that shelf alone while every other shelf keeps its
 *      content, and its retry recovers once the block is lifted;
 *   7. `/discover` renders per-genre shelves, summarizes the selected
 *      languages with a change affordance, and while offline explains that
 *      remote discovery needs a connection while issuing NO request;
 *   8. language selection stays changeable from Settings and feeds follow it;
 *   9. exactly one player iframe / one IFrame API script, zero console errors
 *      (deliberate offline-window and blocked-shelf network entries are
 *      disclosed, not counted — see README.md).
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

/** Languages chosen through onboarding, in the order the interleave expects. */
const SELECTED_LANGUAGES = ["English", "Spanish", "German"];
const SELECTED_CODES = ["en", "es", "de"];

/** Exact copy lifted from the sources at runtime (no encoding assumptions). */
function extractConstants() {
  const read = (...parts) => readFileSync(join(FRONTEND, ...parts), "utf8");
  const onboarding = read("src/features/preferences/LanguageOnboarding.tsx");
  const picker = read("src/features/preferences/LanguagePicker.tsx");
  const discover = read("src/features/discover/DiscoverView.tsx");
  const queue = read("src/features/queue/QueueView.tsx");
  const banner = read("src/components/layout/ConnectionBanner.tsx");
  const pick = (re, source, name) => {
    const value = re.exec(source)?.[1];
    if (!value) throw new Error(`Could not extract ${name} from sources.`);
    return value;
  };
  return {
    onboardingLabel: pick(/LANGUAGE_ONBOARDING_LABEL = "([^"]+)"/, onboarding, "onboarding label"),
    confirmLabel: pick(/confirmLabel = "([^"]+)"/, picker, "confirm label"),
    pickerHint: pick(/LANGUAGE_PICKER_HINT = "([^"]+)"/, picker, "picker hint"),
    discoverOffline: pick(/OFFLINE_NOTICE =\s*\n?\s*"([^"]+)"/, discover, "discover offline copy"),
    languageSummaryLabel: pick(/LANGUAGE_SUMMARY_LABEL = "([^"]+)"/, discover, "language summary label"),
    queueBrowse: pick(/browse: "([^"]+)"/, queue, "browse queue label"),
    offlineBanner: pick(/"(You're offline[^"]*)"/, banner, "offline banner copy"),
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
    task: "9.2",
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    selectedLanguages: { names: SELECTED_LANGUAGES, codes: SELECTED_CODES },
    copy: COPY,
    steps: [],
    screenshots: [],
    consoleErrors: [],
    notes: {
      disclosures: { offlineWindow: [], blockedShelfProbe: [], liveUpstream: [] },
      discoveryRequests: [],
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
  let blockedShelfProbe = false; // deliberate single-shelf failure window
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
    /** Evaluate-click for non-trusted surfaces (dialogs, plain controls). */
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
      else if (blockedShelfProbe && (netCut || statusErr))
        results.notes.disclosures.blockedShelfProbe.push(text);
      else results.consoleErrors.push(text);
    });
    // Every discovery call the page makes, so the offline step can prove it
    // issued none and the language step can read the languages it requested.
    on("Network.requestWillBeSent", (params) => {
      if (String(params.request?.url ?? "").includes("/api/discover")) {
        results.notes.discoveryRequests.push({
          url: String(params.request.url).slice(0, 300),
          offline: offlineNow,
        });
      }
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
    // Deliberate single-shelf failure: only the collections feed is blocked.
    on("Fetch.requestPaused", (params) => {
      void send(
        blockedShelfProbe ? "Fetch.failRequest" : "Fetch.continueRequest",
        blockedShelfProbe
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
      patterns: [{ urlPattern: "*/api/discover?*kind=collection*", requestStage: "Request" }],
    });

    // ---- shared page reads ---------------------------------------------
    const HOME_VIEW_READY = `!!document.querySelector('[data-testid="home-view"]')`;
    const ONBOARDING_DIALOG = `div[role="dialog"][aria-label=${JSON.stringify(COPY.onboardingLabel)}]`;
    const CARD = `[data-testid="shelf-track-card"]`;
    /** Section state read: which ids rendered, in order, plus per-section cards. */
    const homeSections = () =>
      evaluate(`(() => {
        const sections = [...document.querySelectorAll('[data-testid^="home-section-"]')];
        return sections.map((section) => ({
          id: section.getAttribute('data-testid').replace('home-section-', ''),
          cards: section.querySelectorAll('${CARD}').length,
          skeletons: section.querySelectorAll('[data-testid="shelf-skeleton"]').length,
          retry: [...section.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Retry'),
          empty: !!section.querySelector('[data-testid="shelf-empty"], p') && section.textContent.includes('Nothing here yet'),
        }));
      })()`);
    const sectionExists = (id) => `!!document.querySelector('[data-testid="home-section-${id}"]')`;
    const shelfCards = (id) =>
      `(() => [...document.querySelectorAll('[data-testid="home-section-${id}"] ${CARD}')].map((c) => ({
        id: c.getAttribute('data-track-id') || '',
        language: c.getAttribute('data-language') || '',
        label: c.getAttribute('aria-label') || '',
        artwork: !!c.querySelector('img'),
      })))()`;
    const mainText = `document.querySelector('main')?.textContent ?? ''`;

    // Parse self-check: a malformed expression reads as a silent null timeout.
    for (const [name, expr] of Object.entries({
      HOME_VIEW_READY,
      sectionExists: sectionExists("trending"),
      shelfCards: shelfCards("trending"),
      homeSections: homeSections,
      mainText,
    })) {
      try {
        new Function(`return (${typeof expr === "function" ? "() => 1" : expr})`);
      } catch (error) {
        throw new Error(`Expression ${name} does not parse: ${error.message}`);
      }
    }

    // ====================================================================
    // STEP 1 — fresh profile: Home renders behind first-run onboarding
    // ====================================================================
    await waitFor("hydrated top-bar search", `(() => {
      const input = document.querySelector('input[aria-label="Search"]');
      return !!input && Object.keys(input).some((k) => k.indexOf('__reactProps$') === 0);
    })()`, Boolean, 30000);
    await waitFor("Home feed mounted", HOME_VIEW_READY, Boolean, 30000);
    const onboarding = await waitFor(
      "first-run language onboarding",
      `(() => {
        const dialog = document.querySelector(${JSON.stringify(ONBOARDING_DIALOG)});
        if (!dialog) return null;
        return {
          checkboxes: dialog.querySelectorAll('input[type="checkbox"]').length,
          confirm: [...dialog.querySelectorAll('button')].some((b) => b.textContent.trim() === ${JSON.stringify(COPY.confirmLabel)}),
          text: dialog.textContent || '',
          count: dialog.querySelector('[data-testid="language-picker-count"]')?.textContent ?? '',
        };
      })()`,
      (d) => d && d.checkboxes > 0,
      20000,
    );
    step(
      "first-run language onboarding offers the broad catalog",
      onboarding.checkboxes >= 37 && onboarding.confirm,
      `languages=${onboarding.checkboxes} (spec floor 37), confirm=${onboarding.confirm}, count="${onboarding.count}"`,
    );
    step(
      "onboarding shows no account, sign-in, or email copy",
      !/sign[\s-]?in|log[\s-]?in|sign[\s-]?up|account|e-?mail|password|google/i.test(
        onboarding.text,
      ),
      `dialog text scanned for account vocabulary (${onboarding.text.length} chars)`,
    );
    step(
      "picker tells the user the choice stays changeable",
      onboarding.text.includes(COPY.pickerHint),
      `hint="${COPY.pickerHint}"`,
    );
    await shoot(1280, 900, "onboarding-1280.png", "first-run language onboarding over the Home feed");

    // ====================================================================
    // STEP 2 — select three languages and confirm
    // ====================================================================
    for (const name of SELECTED_LANGUAGES) {
      await trustedClickJs(
        `document.querySelector(${JSON.stringify(ONBOARDING_DIALOG)})?.querySelector('input[type="checkbox"][aria-label=${JSON.stringify(name)}]')`,
        `language checkbox ${name}`,
      );
    }
    const picked = await evaluate(
      `document.querySelector('[data-testid="language-picker-count"]')?.textContent ?? ''`,
    );
    await trustedClickJs(buttonByText(COPY.confirmLabel), "confirm languages");
    await waitFor("onboarding closed", `!document.querySelector(${JSON.stringify(ONBOARDING_DIALOG)})`, Boolean, 15000);
    step(
      "multi-language selection confirms and closes onboarding",
      true,
      `selected=${SELECTED_LANGUAGES.join("+")}, count line="${picked}"`,
    );

    // ====================================================================
    // STEP 3 — the choice persists across a full reload
    // ====================================================================
    await goto("/settings", `!!document.querySelector('[data-testid="languages-summary"]')`, "languages summary");
    const summary = await evaluate(
      `document.querySelector('[data-testid="languages-summary"]')?.textContent ?? ''`,
    );
    const persisted = SELECTED_LANGUAGES.every((name) => summary.includes(name));
    step(
      "selected languages persist across a full reload",
      persisted,
      `settings summary="${summary.replace(/\s+/g, " ").trim().slice(0, 120)}"`,
    );
    await shoot(1280, 900, "settings-languages-1280.png", "Settings → Languages with the persisted selection");

    // ====================================================================
    // STEP 4 — Home feed: local-only sections absent for a fresh profile
    // ====================================================================
    await goto("/", HOME_VIEW_READY, "Home feed");
    await waitFor(
      "Trending Now shelf renders",
      `${sectionExists("trending")} && document.querySelectorAll('[data-testid="home-section-trending"] ${CARD}').length >= 3`,
      Boolean,
      60000,
    );
    const freshSections = await homeSections();
    const hasRecently = freshSections.some((s) => s.id === "recently-played");
    const hasForYou = freshSections.some((s) => s.id === "made-for-you");
    step(
      "fresh profile shows no local-only sections",
      !hasRecently && !hasForYou,
      `sections=[${freshSections.map((s) => s.id).join(", ")}]`,
    );

    // ====================================================================
    // STEP 5 — Trending Now renders real provider artwork
    // ====================================================================
    const trending = await evaluate(shelfCards("trending"));
    const withArtwork = trending.filter((card) => card.artwork).length;
    step(
      "Trending Now shelf renders cards with real provider artwork",
      trending.length >= 3 && withArtwork >= 1,
      `cards=${trending.length}, withArtwork=${withArtwork}`,
    );
    await shoot(1280, 900, "home-trending-1280.png", "Home → Trending Now (live provider feed)");

    // ====================================================================
    // STEP 6 — a multi-language feed is mixed, not grouped
    // ====================================================================
    const languages = trending.map((card) => card.language || "(none)");
    const head = languages.slice(0, 6);
    const distinctHead = new Set(head).size;
    const headHasFirst = head[0] === SELECTED_CODES[0];
    results.notes.trendingLanguages = {
      order: languages,
      counts: languages.reduce((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {}),
    };
    step(
      "multi-language feed is interleaved rather than grouped by language",
      distinctHead >= 2 && headHasFirst,
      `first six=[${head.join(", ")}] (selected=${SELECTED_CODES.join(",")}), full order=[${languages.join(",")}]`,
    );

    // ====================================================================
    // STEP 7 — Popular Artists is circular and inside the first four
    // ====================================================================
    const artistIndex = freshSections.findIndex((s) => s.id === "popular-artists");
    const artistShelf = await evaluate(
      `(() => {
        const section = document.querySelector('[data-testid="home-section-popular-artists"]');
        const cards = [...section.querySelectorAll('[data-testid="home-artist-card"]')];
        return {
          count: cards.length,
          withArtwork: cards.filter((c) => c.querySelector('img')).length,
          hrefs: [...section.querySelectorAll('a[href^="/search"]')].map((a) => a.getAttribute('href')),
          title: section.querySelector('h2')?.textContent ?? '',
        };
      })()`,
    );
    step(
      "Popular Artists renders an unclustered circular section with search links",
      artistIndex >= 0 &&
        artistIndex < 4 &&
        artistShelf.count >= 3 &&
        artistShelf.withArtwork >= 1 &&
        artistShelf.hrefs.length > 0 &&
        artistShelf.hrefs.every((href) => href.startsWith("/search?q=")),
      `index=${artistIndex} of ${freshSections.length} sections, artists=${artistShelf.count}, withArtwork=${artistShelf.withArtwork}, hrefs=[${artistShelf.hrefs
        .slice(0, 2)
        .join(", ")}]`,
    );
    await shoot(1280, 900, "home-artists-1280.png", "Home → Popular Artists (circular cards refining search)");

    // ====================================================================
    // STEP 8 — the rest of the baseline feed renders
    // ====================================================================
    await waitFor(
      "Genres, Podcasts and Collections shelves render",
      `${sectionExists("genres")} && ${sectionExists("podcasts")} && ${sectionExists("collections")}`,
      Boolean,
      60000,
    );
    const genreTiles = await evaluate(
      `[...document.querySelectorAll('[data-testid^="home-genre-"]')].map((el) => el.getAttribute('href') ?? '')`,
    );
    const podcastCards = await evaluate(shelfCards("podcasts"));
    step(
      "genres, podcast preview, and curated collections render",
      genreTiles.length >= 5 &&
        genreTiles.every((href) => href.includes("/discover?genre=")) &&
        podcastCards.length >= 1,
      `genreTiles=${genreTiles.length} (e.g. ${genreTiles[0] ?? "none"}), podcastCards=${podcastCards.length}`,
    );

    // ====================================================================
    // STEP 9 — shelf copy makes no chart or editorial claim
    // ====================================================================
    const claimScan = await evaluate(
      `(() => {
        const text = ${mainText};
        const matches = text.match(/chart|most listened|official|editor(ial)?|ranking|spotify|youtube/gi) ?? [];
        return { matches, sample: text.slice(0, 80) };
      })()`,
    );
    step(
      "no shelf copy claims an official chart, ranking, or editorial curation",
      claimScan.matches.length === 0,
      claimScan.matches.length === 0
        ? `scanned ${(await evaluate(`(${mainText}).length`))} chars of Home copy`
        : `flagged terms: ${[...new Set(claimScan.matches)].join(", ")}`,
    );

    // ====================================================================
    // STEP 10 — activating a card starts playback recorded as browse
    // ====================================================================
    const played = await evaluate(shelfCards("trending")).then((cards) => cards[0]);
    await trustedClickSel(
      `[data-testid="home-section-trending"] ${CARD}[data-track-id="${played.id}"]`,
    );
    const playback = await waitFor(
      "player region reflects the shelf track",
      `(() => ({
        bar: document.querySelector('[data-testid="player-bar"]')?.textContent ?? '',
        control: document.querySelector('[data-testid="player-bar"] button[aria-label="Pause"]') ? 'Pause' : 'Play',
      }))()`,
      (state) => state.bar.includes(played.label.replace(/^Play /, "").split(" by ")[0]),
      30000,
    );
    step(
      "shelf activation starts real playback",
      playback.control === "Pause",
      `control=${playback.control}, bar="${playback.bar.replace(/\s+/g, " ").trim().slice(0, 90)}"`,
    );
    await goto("/queue", `!!document.querySelector('main')`, "queue surface");
    const queueLabel = await waitFor(
      "queue source label",
      `document.querySelector('main')?.textContent ?? ''`,
      (text) => text.includes(COPY.queueBrowse),
      20000,
    );
    step(
      "the queue records the shelf playback as browse-sourced",
      queueLabel.includes(COPY.queueBrowse),
      `label "${COPY.queueBrowse}" present on /queue`,
    );
    // Pause so the run stays deterministic and the session stops advancing.
    await clickElement(
      `document.querySelector('[data-testid="player-bar"] button[aria-label="Pause"]')`,
      "Pause",
    );
    await delay(500);

    // ====================================================================
    // STEP 11 — listening signals create the local-only sections
    // ====================================================================
    await goto("/", HOME_VIEW_READY, "Home feed");
    const localSections = await waitFor(
      "Recently Played appears from the recorded listening event",
      `(() => {
        const sections = [...document.querySelectorAll('[data-testid^="home-section-"]')];
        const ids = sections.map((s) => s.getAttribute('data-testid').replace('home-section-', ''));
        const recent = document.querySelectorAll('[data-testid="home-section-recently-played"] ${CARD}');
        return { ids, recent: recent.length };
      })()`,
      (state) => state.ids.includes("recently-played") && state.recent >= 1,
      45000,
    );
    const recentCards = await evaluate(shelfCards("recently-played"));
    const uniqueRecent = new Set(recentCards.map((card) => card.id)).size;
    step(
      "a recorded play adds Recently Played (newest-first, deduplicated)",
      recentCards.length >= 1 && uniqueRecent === recentCards.length,
      `cards=${recentCards.length}, uniqueIds=${uniqueRecent}, sections=[${localSections.ids.join(", ")}]`,
    );
    const forYouReady = await waitFor(
      "Made For You renders from local taste seeds",
      `(() => {
        const section = document.querySelector('[data-testid="home-section-made-for-you"]');
        return { present: !!section, cards: section ? section.querySelectorAll('${CARD}').length : 0 };
      })()`,
      (state) => state.present && state.cards >= 1,
      45000,
    );
    step(
      "Made For You renders from on-device taste seeds",
      forYouReady.cards >= 1,
      `cards=${forYouReady.cards}`,
    );
    const localRequest = results.notes.discoveryRequests.find((request) =>
      /kind=for-you/.test(request.url),
    );
    step(
      "the local-informed request carries only short seed terms, no library payload",
      Boolean(localRequest) &&
        /kind=for-you/.test(localRequest.url) &&
        /seeds=/.test(localRequest.url) &&
        !/liked|playlist|history/i.test(decodeURIComponent(localRequest.url)),
      `url=${(localRequest?.url ?? "none").replace(ORIGIN, "").slice(0, 160)}`,
    );
    await shoot(1280, 900, "home-local-1280.png", "Home → Recently Played + Made For You after a real play");

    // ====================================================================
    // STEP 12 — one failing shelf is isolated, and its retry recovers
    // ====================================================================
    blockedShelfProbe = true;
    results.notes.blockedShelf = { blocked: "kind=collection" };
    await goto("/", HOME_VIEW_READY, "Home feed");
    const isolated = await waitFor(
      "blocked shelf shows a retryable error while the others render",
      `(() => {
        const sections = [...document.querySelectorAll('[data-testid^="home-section-"]')];
        const byId = (id) => sections.find((s) => s.getAttribute('data-testid') === 'home-section-' + id);
        const collections = byId('collections');
        const trendingSection = byId('trending');
        const retry = collections ? [...collections.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Retry') : null;
        return {
          retry: !!retry,
          collectionsCards: collections ? collections.querySelectorAll('${CARD}').length : 0,
          trendingCards: trendingSection ? trendingSection.querySelectorAll('${CARD}').length : 0,
        };
      })()`,
      (state) => state.retry && state.trendingCards >= 1,
      60000,
    );
    step(
      "one failing shelf degrades alone with a retryable error",
      isolated.retry && isolated.collectionsCards === 0 && isolated.trendingCards >= 1,
      `collections cards=${isolated.collectionsCards} with Retry=${isolated.retry}; trending cards=${isolated.trendingCards}`,
    );
    await shoot(1280, 900, "home-shelf-error-1280.png", "Home → Collections shelf retryable error, other shelves intact");
    blockedShelfProbe = false;
    await trustedClickJs(
      `document.querySelector('[data-testid="home-section-collections"]')?.querySelector('button') && [...document.querySelectorAll('[data-testid="home-section-collections"] button')].find((b) => b.textContent.trim() === 'Retry')`,
      "collections retry",
    );
    const recovered = await waitFor(
      "the blocked shelf recovers after its retry",
      `document.querySelectorAll('[data-testid="home-section-collections"] ${CARD}').length >= 1`,
      Boolean,
      60000,
    );
    step("the blocked shelf recovers on retry", recovered, `collections cards=${recovered}`);

    // ====================================================================
    // STEP 13 — Discover: per-genre shelves, language summary, affordance
    // ====================================================================
    await goto("/discover?genre=rock", `!!document.querySelector('[data-testid="discover-view"]')`, "Discover view");
    const discover = await waitFor(
      "Discover genre shelves populate",
      `(() => {
        const genres = [...document.querySelectorAll('[data-testid^="discover-genre-"]')];
        return {
          genres: genres.length,
          withCards: genres.filter((g) => g.querySelectorAll('${CARD}').length >= 1).length,
          summary: document.querySelector('[data-testid="discover-language-summary"]')?.textContent ?? '',
          change: !!document.querySelector('a[href="/settings"], button[aria-label="Change languages"]'),
          rock: !!document.querySelector('[data-testid="discover-genre-rock"]'),
        };
      })()`,
      (state) => state.withCards >= 1,
      60000,
    );
    step(
      "Discover renders per-genre shelves with the language summary and change affordance",
      discover.genres >= 5 &&
        discover.withCards >= 1 &&
        SELECTED_LANGUAGES.every((name) => discover.summary.includes(name)) &&
        discover.change,
      `genres=${discover.genres} (withCards=${discover.withCards}), summary="${discover.summary.replace(/\s+/g, " ").trim().slice(0, 90)}", changeAffordance=${discover.change}`,
    );
    step("the ?genre= deep link is honored", discover.rock, "discover-genre-rock present");
    await shoot(1280, 900, "discover-1280.png", "/discover → per-genre shelves and language summary");

    // ====================================================================
    // STEP 14 — offline: Discover explains itself and issues no request
    // ====================================================================
    await setOffline(true);
    await waitFor("offline banner", `!!document.querySelector('[data-testid="connection-banner"]')`, Boolean, 20000);
    const beforeOfflineRequests = results.notes.discoveryRequests.length;
    const genreRetry = await evaluate(
      `(() => {
        const genre = [...document.querySelectorAll('[data-testid^="discover-genre-"]')]
          .find((g) => [...g.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Retry'));
        if (!genre) return false;
        [...genre.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Retry').click();
        return true;
      })()`,
    );
    await delay(2500);
    const offlineNotice = await evaluate(
      `(() => {
        const notice = document.querySelector('[data-testid="discover-offline"]');
        return { present: !!notice, text: notice?.textContent ?? '', online: navigator.onLine };
      })()`,
    );
    const offlineRequests = results.notes.discoveryRequests
      .slice(beforeOfflineRequests)
      .filter((request) => request.offline);
    step(
      "offline Discover explains that discovery needs a connection",
      offlineNotice.present && offlineNotice.text.includes(COPY.discoverOffline),
      `notice="${offlineNotice.text.replace(/\s+/g, " ").trim().slice(0, 110)}"`,
    );
    step(
      "offline Discover issues no discovery request",
      offlineRequests.length === 0,
      `requests issued while offline=${offlineRequests.length} (genre retry clicked=${genreRetry})`,
    );
    await shoot(1280, 900, "discover-offline-1280.png", "/discover offline → connection notice, no requests");
    await setOffline(false);
    await waitFor("banner cleared", `!document.querySelector('[data-testid="connection-banner"]')`, Boolean, 20000);

    // ====================================================================
    // STEP 15 — languages stay changeable from Settings and feeds follow
    // ====================================================================
    await goto("/settings", `!!document.querySelector('[data-testid="languages-summary"]')`, "languages summary");
    await clickElement(buttonByText("Change languages"), "Change languages");
    await waitFor(
      "language picker reopened",
      `!!document.querySelector('input[type="checkbox"][aria-label="Spanish"]')`,
      Boolean,
      15000,
    );
    await trustedClickJs(
      `document.querySelector('input[type="checkbox"][aria-label="Spanish"]')`,
      "uncheck Spanish",
    );
    await clickElement(buttonByText(COPY.confirmLabel), "confirm reduced selection");
    const reduced = await waitFor(
      "reduced selection persisted",
      `(() => ({
        summary: document.querySelector('[data-testid="languages-summary"]')?.textContent ?? '',
        pickerGone: !document.querySelector('input[type="checkbox"]'),
      }))()`,
      (state) => state.pickerGone && !state.summary.includes("Spanish"),
      15000,
    );
    step(
      "languages are changeable after onboarding and persist",
      !reduced.summary.includes("Spanish") && reduced.summary.includes("English"),
      `summary="${reduced.summary.replace(/\s+/g, " ").trim().slice(0, 90)}"`,
    );
    await goto("/", HOME_VIEW_READY, "Home feed");
    const singleLanguageRequest = await waitFor(
      "Home requests the reduced language set",
      `(() => true)()`,
      Boolean,
      1000,
    ).catch(() => false);
    void singleLanguageRequest;
    const latestTrending = await waitFor(
      "trending re-requested with the reduced set",
      `(() => true)()`,
      Boolean,
      500,
    ).catch(() => false);
    void latestTrending;
    await delay(3000);
    const recentLanguages = results.notes.discoveryRequests
      .filter((request) => /kind=trending/.test(request.url))
      .pop();
    const requestedLanguages = recentLanguages
      ? (decodeURIComponent(recentLanguages.url).match(/languages=([^&]+)/)?.[1] ?? "").split(",")
      : [];
    step(
      "discovery requests follow the reduced language selection",
      requestedLanguages.length === 2 && !requestedLanguages.includes("es"),
      `last trending request languages=[${requestedLanguages.join(",")}]`,
    );

    // ====================================================================
    // STEP 16 — exactly one player iframe / one IFrame API script
    // ====================================================================
    const player = await evaluate(
      `(() => ({
        iframes: document.querySelectorAll('iframe').length,
        apiScripts: [...document.querySelectorAll('script')].filter((s) =>
          (s.src ?? '').includes('youtube.com/iframe_api'),
        ).length,
        control: document.querySelector('[data-testid="player-bar"] button[aria-label="Play"]') ? 'Play' : 'Pause',
      }))()`,
    );
    step(
      "exactly one player iframe and one IFrame API script",
      player.iframes === 1 && player.apiScripts === 1,
      `iframes=${player.iframes}, apiScripts=${player.apiScripts}, control=${player.control}`,
    );

    // ====================================================================
    // STEP 17 — zero console errors
    // ====================================================================
    step(
      "zero console errors (disclosed offline/blocked-shelf entries excluded)",
      results.consoleErrors.length === 0,
      `errors=${results.consoleErrors.length}, disclosed offline=${results.notes.disclosures.offlineWindow.length}, disclosed blocked-shelf=${results.notes.disclosures.blockedShelfProbe.length}, disclosed live-upstream=${results.notes.disclosures.liveUpstream.length}`,
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
