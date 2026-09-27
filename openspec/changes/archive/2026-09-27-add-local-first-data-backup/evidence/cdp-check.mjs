#!/usr/bin/env node
/**
 * M2 task 7.2 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Drives a production build (`next start`) in headless Edge over the
 * Chrome DevTools Protocol to capture:
 *   1. `/settings` screenshots at 390px and 1280px viewports;
 *   2. a scripted import → reload → export round-trip proving imported data
 *      survives a page reload and the exported backup matches the import;
 *   3. the session's console errors (must be zero).
 *
 * Writes `results.json` and the screenshots next to this script (the change's
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

/** Deterministic fixture backup — mirrors the known-valid unit fixture shape. */
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
    exportedAt: "2026-09-27T12:00:00.000Z",
    appVersion: "0.1.0",
    data: {
      preferences: {
        languages: ["hi"],
        autoplayNext: true,
        reduceMotion: false,
        onboardingComplete: true,
      },
      likedTracks: [
        { trackId: "t1", track: track("t1"), likedAt: 1000 },
        { trackId: "t2", track: track("t2"), likedAt: 2000 },
      ],
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
        queue: [track("t1")],
        queueIndex: 0,
        positionSeconds: 10,
        repeatMode: "off",
        shuffle: false,
        volume: 0.5,
        updatedAt: 900,
      },
    },
  };
}

/** Order-independent, key-order-independent comparison of exported data. */
const ARRAY_KEYS = {
  likedTracks: "trackId",
  playlists: "id",
  history: "id",
  searchHistory: "normalizedQuery",
};

function normalizeData(data) {
  const out = { preferences: data.preferences, session: data.session };
  for (const [key, sortKey] of Object.entries(ARRAY_KEYS)) {
    out[key] = [...(data[key] ?? [])].sort((a, b) =>
      a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0,
    );
  }
  return out;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

async function main() {
  const results = {
    task: "7.2",
    generatedAt: new Date().toISOString(),
    target: `${ORIGIN}/settings`,
    origin: ORIGIN,
    steps: [],
    screenshots: [],
    consoleErrors: [],
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
  const downloadDir = join(profileDir, "downloads");
  mkdirSync(downloadDir, { recursive: true });

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
      throw new Error(`Production server not reachable at ${ORIGIN} — run "npm run build" then "npm run start" first.`);
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
        await delay(200);
      }
      throw new Error(`Timed out waiting for ${description} (last: ${JSON.stringify(last)})`);
    };

    // ---- console/network error capture --------------------------------
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
    try {
      await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
    } catch {
        /* older/newer Chrome variants may not expose this — non-fatal */
    }

    const READY = `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Export backup'); return !!b && !b.disabled; })()`;
    const FEEDBACK = `document.querySelector('[data-testid="data-controls-feedback"]')?.textContent ?? null`;

    // ---- 1. initial /settings screenshots -----------------------------
    await send("Page.navigate", { url: `${ORIGIN}/settings` });
    await waitFor("settings controls ready", READY, Boolean);
    step("settings page ready (fresh profile, empty database)", true);

    const shoot = async (width, height, file, note) => {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await delay(500);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(EVIDENCE_DIR, file), Buffer.from(shot.data, "base64"));
      results.screenshots.push(note ? { file, width, height, note } : { file, width, height });
    };
    await shoot(390, 844, "settings-390.png");
    step("captured /settings at 390px", true, "settings-390.png");
    await shoot(1280, 900, "settings-1280.png");
    step("captured /settings at 1280px", true, "settings-1280.png");
    await send("Emulation.clearDeviceMetricsOverride");
    await delay(300);

    // ---- 2. import the fixture through the UI --------------------------
    const fixture = makeFixture();
    const fixturePath = join(profileDir, "fixture-backup.json");
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
    results.fixture = fixture.data;

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
      (text) => typeof text === "string" && (/^Import complete/.test(text) || /unchanged\.$/.test(text)),
      30000,
    );
    results.importFeedback = importFeedback;
    step(
      "imported fixture backup via Import backup file picker",
      /^Import complete \(merge mode\)/.test(importFeedback),
      importFeedback,
    );
    await shoot(1280, 900, "settings-import-success-1280.png", "supplementary: post-import success feedback");
    step("captured post-import success feedback", true);

    // ---- 3. reload: imported data must survive -------------------------
    await send("Page.reload", { ignoreCache: true });
    await waitFor("controls ready after reload", READY, Boolean);
    step("page reloaded and controls ready again", true);

    // ---- 4. export and compare with the imported fixture ---------------
    await evaluate(`
      window.__capture = { blobs: [], names: [] };
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { window.__capture.blobs.push(blob); return origCreate(blob); };
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.__capture.names.push(this.download);
        return origClick.call(this);
      };
      true
    `);
    await evaluate(
      `[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Export backup').click(); true`,
    );
    const exportFeedback = await waitFor(
      "export completion feedback",
      FEEDBACK,
      (text) => typeof text === "string" && (/^Backup downloaded/.test(text) || /unchanged\.$/.test(text)),
      30000,
    );
    results.exportFeedback = exportFeedback;

    const captured = await waitFor(
      "export blob",
      `(async () => {
        if (window.__capture.blobs.length === 0) return null;
        return { text: await window.__capture.blobs[0].text(), names: window.__capture.names };
      })()`,
      (value) => value !== null,
      30000,
    );
    step("export produced a JSON download", /^Backup downloaded/.test(exportFeedback), exportFeedback);
    results.exportedFilename = captured.names[0] ?? "";
    step(
      "download filename is spotivibe-backup-YYYY-MM-DD.json",
      /^spotivibe-backup-\d{4}-\d{2}-\d{2}\.json$/.test(results.exportedFilename),
      results.exportedFilename,
    );

    const exported = JSON.parse(captured.text);
    step(
      "exported envelope format/version valid",
      exported.format === "spotivibe-backup" && exported.version === 1,
      `${exported.format} v${exported.version}, appVersion ${exported.appVersion ?? "(none)"}`,
    );

    const expected = stableStringify(normalizeData(fixture.data));
    const actual = stableStringify(normalizeData(exported.data));
    results.roundTrip = {
      deepEqual: expected === actual,
      comparedWith: "order-independent deep equality of the six backup datasets",
      exportedDataKeys: Object.keys(exported.data ?? {}).sort(),
    };
    step("export after reload matches the imported backup (data survived reload)", expected === actual,
      expected === actual ? "six datasets deep-equal" : `mismatch\nexpected ${expected}\nactual   ${actual}`);

    // ---- 5. console hygiene --------------------------------------------
    step("zero console errors during the whole session", results.consoleErrors.length === 0,
      results.consoleErrors.join(" | ") || "none");

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
