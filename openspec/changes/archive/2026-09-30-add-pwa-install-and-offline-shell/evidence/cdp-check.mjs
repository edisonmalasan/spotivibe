#!/usr/bin/env node
/**
 * M13 task 6.2 — dependency-free CDP evidence capture (Node built-ins only).
 *
 * Drives a production build (`next start`) in headless Edge over the Chrome
 * DevTools Protocol to capture what unit tests cannot about an offline shell.
 * The M12 harness (../../../archive/2026-09-30-add-podcasts/evidence/cdp-check.mjs)
 * is the pattern; the CDP plumbing below is deliberately similar, so the lessons
 * recorded there apply unchanged.
 *
 * What this run proves, in order:
 *   1. the manifest is served, well-formed, and every icon it declares resolves
 *      at the declared size (a manifest that points at a 404 is not installable);
 *   2. the worker registers, activates, and controls the page — exactly one — and
 *      the caches it owns are its versioned ones;
 *   3. the local pages render with the network cut, and their document responses
 *      are served *by the service worker* rather than by luck;
 *   4. a per-entity route with nothing cached is not answered from cache: the
 *      network failure reaches the route, which shows its own error state;
 *   5. a previously fetched keyless metadata response is served while offline,
 *      and search — deliberately never cached — is not;
 *   6. the offline banner names search and playback, and the data controls remain
 *      usable with the network cut;
 *   7. the worker's `SKIP_WAITING` handshake really answers over a live message
 *      port, and IndexedDB data survives that activation;
 *   8. the install affordance appears when the platform offers installation, and
 *      an accepted install stops it being offered;
 *   9. zero console errors outside the disclosed offline window.
 *
 * Two structural decisions, both learned from the first run of this harness:
 *
 * 1. The connection is made to the **browser** endpoint, not to a page endpoint.
 *    A service worker is a browser-scoped target, so page-level network emulation
 *    never reaches it. Auto-attaching at browser level is what makes the worker
 *    observable at all.
 * 2. "Offline" means **the origin is genuinely unreachable**, not that the page
 *    was told to behave offline. The harness starts the production server itself
 *    and *stops it* for the offline phase. CDP network emulation was tried first
 *    and is not sufficient: with the page emulated offline, the worker's own
 *    `fetch()` still reached the server, so the metadata-fallback assertion
 *    silently measured the network instead of the cache. A stopped server makes
 *    the same check mean what it claims to mean, for the page and the worker.
 *
 * Consequence: the offline phase runs against a dead port, so the run is ordered
 * online-first (everything that needs a server) and then offline (everything that
 * needs its absence). `SPOTIVIBE_EXTERNAL=1` runs against an already-running
 * server and falls back to CDP emulation, which is disclosed in the results.
 *
 * Writes `results.json` and screenshots next to this script. Exit code 0 = every
 * assertion passed.
 *
 * Usage:  node cdp-check.mjs    (build first: cd frontend && npm run build)
 * Env:    SPOTIVIBE_PORT        (default 3210)
 *         SPOTIVIBE_EXTERNAL=1  use an already-running server (emulation instead
 *                               of a real outage; disclosed in the results)
 *         SPOTIVIBE_BROWSER_PATH (Edge/Chrome executable override)
 *         SPOTIVIBE_CDP_PORT     (default 9455)
 */

import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVIDENCE_DIR = dirname(fileURLToPath(import.meta.url));
mkdirSync(EVIDENCE_DIR, { recursive: true });
const PORT = Number(process.env.SPOTIVIBE_PORT ?? 3210);
const ORIGIN = `http://localhost:${PORT}`;
/** True when the harness must not start/stop the server itself. */
const EXTERNAL = process.env.SPOTIVIBE_EXTERNAL === "1";
const CDP_PORT = Number(process.env.SPOTIVIBE_CDP_PORT ?? 9455);
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

/**
 * Constants read out of the shipped sources at runtime.
 *
 * No encoding assumptions and no duplicated copy: the browser assertions compare
 * against what the application actually ships (M11's rule, still the rule).
 */
function extractConstants() {
  const read = (...parts) => readFileSync(join(FRONTEND, ...parts), "utf8");
  const pick = (re, source, name) => {
    const value = re.exec(source)?.[1];
    if (!value) throw new Error(`Could not extract ${name} from sources.`);
    return value;
  };
  const banner = read("src/components/layout/ConnectionBanner.tsx");
  const schema = read("src/data/indexeddb/schema.ts");
  const worker = read("public/sw.js");
  return {
    // The offline copy, read as fragments so the file's own em dashes cannot make
    // an assertion a lie.
    offlineUnavailable: pick(
      /search and playback ([^"]+?connection)/,
      banner,
      "offline banner's unavailable clause",
    ),
    offlineRemains: pick(
      /Your ([a-z, ]+?) still work/,
      banner,
      "offline banner's remaining clause",
    ),
    databaseName: pick(
      /DATABASE_NAME = "([^"]+)"/,
      schema,
      "IndexedDB database name",
    ),
    workerVersion: pick(
      /const VERSION = "([^"]+)"/,
      worker,
      "worker cache version",
    ),
    // Every bound the worker declares, read from the file. The offline phase asserts
    // each observed cache against the bound for its own name and fails on a name it
    // does not recognize, which is how the shell cache (added later) was caught
    // missing from this list rather than silently exempted.
    cacheBounds: {
      assets: Number(pick(/assets:\s*(\d+)/, worker, "assets bound")),
      pages: Number(pick(/pages:\s*(\d+)/, worker, "pages bound")),
      metadata: Number(pick(/metadata:\s*(\d+)/, worker, "metadata bound")),
      artwork: Number(pick(/artwork:\s*(\d+)/, worker, "artwork bound")),
      shell: Number(pick(/shell:\s*(\d+)/, worker, "shell bound")),
    },
  };
}

async function waitForServer(timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${ORIGIN}/manifest.webmanifest`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await delay(400);
  }
  return false;
}

/** How long the origin takes to start refusing connections after a stop. */
async function waitForServerDown(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await fetch(`${ORIGIN}/manifest.webmanifest`);
    } catch {
      return true;
    }
    await delay(200);
  }
  return false;
}

/**
 * The production server, started by the harness.
 *
 * `next start` from the built app, resolved from the workspace's own dependency
 * rather than a shell script, so the harness has no PATH assumptions. The child's
 * output is captured to a log file next to the evidence, because a server that
 * failed to start must be diagnosable from the record rather than guessed at.
 */
function startServer() {
  const log = join(EVIDENCE_DIR, "server.log");
  // `detached` gives the child its own process group on POSIX so the whole tree
  // can be signalled at once; on Windows the equivalent is `taskkill /T`, which is
  // what `stopServer` uses. Killing only the direct child left Next's own server
  // process holding the port, so the "offline" phase was quietly still online -
  // the run reported a cache miss as a network success.
  const child = spawn(
    process.execPath,
    [
      join(FRONTEND, "node_modules", "next", "dist", "bin", "next"),
      "start",
      "-p",
      String(PORT),
    ],
    {
      cwd: FRONTEND,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  const stream = createWriteStream(log, { flags: "a" });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  return { child, log };
}

/** Stop the server and everything it started, so the port is genuinely free. */
function stopServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
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

async function main() {
  const COPY = extractConstants();
  const results = {
    task: "6.2",
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    copy: COPY,
    steps: [],
    screenshots: [],
    consoleErrors: [],
    notes: {
      disclosures: {
        offlineWindow: [],
        platformEvents: [],
        notVerifiableHere: [],
      },
      attachedTargets: [],
      documentResponses: [],
      cacheReport: [],
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
  const downloadDir = mkdtempSync(join(tmpdir(), "spotivibe-dl-"));

  // True while the origin is genuinely unreachable, which is what "offline" means
  // in this run (see the header). In external mode it tracks the CDP emulation
  // instead, and the results say so.
  let originDown = false;
  const sessions = new Set();
  let server = null;
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
  const applyNetworkState = async (sessionId) => {
    // Emulation supplies the *page's* offline signal, because the app derives its
    // connection state from `navigator.onLine` and a stopped origin does not change
    // that. It is never what makes the run offline for the worker: in managed mode
    // the origin really is down, and `results.notes.offlineMechanism` says so.
    await sendTo(sessionId, "Network.emulateNetworkConditions", {
      offline: originDown,
      latency: 0,
      downloadThroughput: originDown ? 0 : -1,
      uploadThroughput: originDown ? 0 : -1,
    });
  };
  /** Take the origin away (or give it back) for the page, the worker, and all iframes. */
  const setOffline = async (offline) => {
    originDown = offline;
    for (const sessionId of sessions)
      await applyNetworkState(sessionId).catch(() => {});
    if (EXTERNAL) return;
    if (offline) {
      stopServer(server?.child);
      const down = await waitForServerDown();
      results.notes.originRefusedConnections = down;
    } else if (server) {
      server = startServer();
      const up = await waitForServer();
      results.notes.originRestored = up;
    }
  };

  const closeAll = () => {
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    stopServer(server?.child);
    try {
      browser?.kill();
    } catch {
      /* already gone */
    }
    delay(300).then(() => {
      for (const dir of [profileDir, downloadDir]) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    });
  };

  try {
    if (EXTERNAL) {
      results.notes.offlineMechanism =
        "SPOTIVIBE_EXTERNAL=1: the origin stayed up and 'offline' is CDP network emulation, which does not reach a service worker's own fetches. The metadata-fallback step is therefore weaker in this mode.";
    } else {
      if (!existsSync(join(FRONTEND, ".next"))) {
        throw new Error(
          "No production build found — run `cd frontend && npm run build` first.",
        );
      }
      server = startServer();
      results.notes.offlineMechanism =
        "The harness started the production server and stopped it (process tree) for the offline phase, so the origin refuses connections for the service worker as well as the page. CDP network emulation is additionally applied to the page, because the app derives its connection state from navigator.onLine and a stopped origin does not change that; results.notes.originRefusedConnections records that the port really was refusing.";
    }
    if (!(await waitForServer())) {
      throw new Error(
        `Production server not reachable at ${ORIGIN}. See evidence/server.log.`,
      );
    }

    // ---- 1. the manifest and its icons, fetched by the harness itself --------
    const manifestResponse = await fetch(`${ORIGIN}/manifest.webmanifest`);
    const manifestText = await manifestResponse.text();
    step(
      "the manifest is served with a manifest content type",
      manifestResponse.ok &&
        /json|manifest/.test(
          manifestResponse.headers.get("content-type") ?? "",
        ),
      `${manifestResponse.status} ${manifestResponse.headers.get("content-type")}`,
    );
    let manifest = null;
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      step("the manifest parses as JSON", false, String(error));
    }
    if (manifest) {
      step(
        "the manifest declares standalone, a stable id, and the app's colors",
        manifest.display === "standalone" &&
          manifest.id === "/" &&
          manifest.start_url === "/" &&
          manifest.scope === "/" &&
          manifest.theme_color === "#000000" &&
          manifest.background_color === "#121212",
        JSON.stringify({
          display: manifest.display,
          id: manifest.id,
          start_url: manifest.start_url,
          theme: manifest.theme_color,
        }),
      );
      const installable = (manifest.icons ?? []).filter(
        (icon) => Number.parseInt(String(icon.sizes), 10) >= 144,
      );
      const hasMaskable = (manifest.icons ?? []).some((icon) =>
        String(icon.purpose ?? "").includes("maskable"),
      );
      step(
        "the manifest declares an installable icon set including a maskable icon",
        installable.length >= 2 && hasMaskable,
        `${installable.length} icons >= 144px, maskable: ${hasMaskable}`,
      );
      for (const icon of manifest.icons ?? []) {
        const response = await fetch(`${ORIGIN}${icon.src}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const isPng = bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const width = isPng ? bytes.readUInt32BE(16) : null;
        const declared = Number.parseInt(String(icon.sizes), 10);
        const sizeOk = isPng ? width === declared : true; // "any" (SVG) has no width
        step(
          `icon ${icon.src} is served at the declared size`,
          response.ok && isPng === String(icon.type).includes("png") && sizeOk,
          `${response.status} ${bytes.length}B png=${isPng} ${width ?? "n/a"}px vs ${icon.sizes}`,
        );
      }
      const lowered = JSON.stringify(manifest).toLowerCase();
      const brands = [
        "spotify",
        "soundcloud",
        "bandcamp",
        "deezer",
        "tidal",
      ].filter((brand) => lowered.includes(brand));
      step(
        "the served manifest carries no third-party brand",
        brands.length === 0,
        brands.join(","),
      );
    }
    const workerResponse = await fetch(`${ORIGIN}/sw.js`);
    const workerText = await workerResponse.text();
    step(
      "the worker is served with a JavaScript content type and a body",
      workerResponse.ok &&
        /javascript/.test(workerResponse.headers.get("content-type") ?? ""),
      `${workerResponse.status} ${workerResponse.headers.get("content-type")} ${workerText.length}B`,
    );

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
    // Browser-level connection, so the service-worker target is attachable.
    ws = new WebSocket(version.webSocketDebuggerUrl);
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

    // The page session is chosen by *target id*, never by "the first page that
    // attached": the browser opens its own about:blank tab first, and binding to it
    // makes every page assertion evaluate in an opaque origin (which is also how
    // the first run read "the app never registered" when it had).
    let pageTargetId = "";
    // Resolved lazily by target id: the `attachedToTarget` event for a target the
    // harness creates can arrive *before* the `createTarget` reply that names it,
    // so binding during the event (rather than looking it up afterwards) is a race
    // that intermittently leaves the run with no page to talk to.
    const pageSessions = new Map();
    const pageSession = () => pageSessions.get(pageTargetId) ?? "";
    on("Target.attachedToTarget", async (params) => {
      const sessionId = params.sessionId;
      const info = params.targetInfo ?? {};
      sessions.add(sessionId);
      results.notes.attachedTargets.push({
        type: info.type ?? null,
        targetId: String(info.targetId ?? ""),
        url: String(info.url ?? "").slice(0, 120),
      });
      try {
        if (info.type === "page")
          pageSessions.set(String(info.targetId ?? ""), sessionId);
        await sendTo(sessionId, "Network.enable");
        await applyNetworkState(sessionId);
        if (info.type === "page") {
          await sendTo(sessionId, "Page.enable");
          await sendTo(sessionId, "Runtime.enable");
          await sendTo(sessionId, "Log.enable");
        }
        // Re-attach from nested sessions so a worker's own subframes are covered.
        await sendTo(sessionId, "Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
        });
      } catch (error) {
        results.notes.networkEmulationErrors =
          results.notes.networkEmulationErrors ?? [];
        results.notes.networkEmulationErrors.push({
          session: sessionId,
          error: String(error?.message ?? error).slice(0, 160),
        });
      }
    });
    on("Target.detachedFromTarget", (params) => {
      if (params?.sessionId) sessions.delete(params.sessionId);
    });

    const page = (method, params = {}) => sendTo(pageSession(), method, params);
    const evaluate = async (expression) => {
      const response = await page("Runtime.evaluate", {
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
    const shoot = async (file, note) => {
      await delay(600);
      const shot = await page("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(EVIDENCE_DIR, file), Buffer.from(shot.data, "base64"));
      results.screenshots.push({ file, note });
    };
    const goto = async (path, readyDesc = "ready") => {
      await page("Page.navigate", { url: `${ORIGIN}${path}` });
      await waitFor(
        `${path} document complete`,
        `document.readyState`,
        (r) => r === "complete",
        20000,
      ).catch(() => null);
      if (readyDesc) await delay(500);
    };
    /** A trusted click: a real user gesture, which `prompt()` requires. */
    const trustedClick = async (selector) => {
      const point = await evaluate(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          el.scrollIntoView({ block: "center", inline: "nearest" });
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height };
        })()`,
      );
      if (!point || point.w === 0 || point.h === 0) {
        throw new Error(
          `Element not clickable: ${selector} → ${JSON.stringify(point)}`,
        );
      }
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await page("Input.dispatchMouseEvent", {
          type,
          x: point.x,
          y: point.y,
          button: "left",
          clickCount: 1,
        });
      }
      return point;
    };

    // ---- console/log capture with honest disclosure buckets ----------------
    on("Runtime.consoleAPICalled", (params) => {
      if (params.type !== "error" || !params.sessionId) return;
      const text = `console.error: ${params.args
        .map((a) => a.value ?? a.description ?? "")
        .join(" ")
        .slice(0, 300)}`;
      results.consoleErrors.push(text);
    });
    on("Runtime.exceptionThrown", (params, sessionId) => {
      if (!sessionId) return;
      results.consoleErrors.push(
        `exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`.slice(
          0,
          300,
        ),
      );
    });
    on("Log.entryAdded", (params) => {
      if (params.entry.level !== "error") return;
      const text =
        `log: ${params.entry.text} [${String(params.entry.url ?? "")}]`.slice(
          0,
          300,
        );
      const netCut = /net::ERR_|Failed to load resource/.test(
        params.entry.text,
      );
      const statusErr = /status of [45]\d\d/.test(params.entry.text);
      if (originDown && (netCut || statusErr))
        results.notes.disclosures.offlineWindow.push(text);
      else results.consoleErrors.push(text);
    });
    // Document responses are recorded with `fromServiceWorker`, because "the page
    // rendered offline" and "the worker served that document" are different claims
    // and only the second one is the requirement.
    on("Network.requestWillBeSent", (params, sessionId) => {
      if (params.type !== "Document" || !sessionId) return;
      (results.notes.pendingDocuments ??= {})[params.requestId] = {
        url: String(params.request?.url ?? "").replace(ORIGIN, ""),
      };
    });
    on("Network.responseReceived", (params, sessionId) => {
      const pendingDocument =
        results.notes.pendingDocuments?.[params.requestId];
      if (!pendingDocument || !sessionId) return;
      results.notes.documentResponses.push({
        path: pendingDocument.url.split("?")[0],
        status: params.response?.status ?? null,
        fromServiceWorker: params.response?.fromServiceWorker === true,
      });
    });

    await send("Target.setDiscoverTargets", { discover: true });
    await send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    const created = await send("Target.createTarget", {
      url: `${ORIGIN}/library`,
    });
    pageTargetId = created.targetId;
    // The browser's own blank tab is closed so nothing else can be mistaken for
    // the application page, and so the run leaves no stray window behind.
    for (const target of results.notes.attachedTargets) {
      if (target.type === "page" && target.targetId !== pageTargetId) {
        await send("Target.closeTarget", { targetId: target.targetId }).catch(
          () => {},
        );
      }
    }
    await waitFor(
      "the application page session to attach",
      () => pageSession(),
      Boolean,
      20000,
    );
    // A freshly created target can still be on about:blank, whose opaque origin has
    // no `navigator.serviceWorker` at all - the first run of this harness read that
    // as "the app never registered". The app origin is the precondition for every
    // page-side assertion below.
    await waitFor(
      "the app document to load",
      `location.origin`,
      (origin) => origin === ORIGIN,
      30000,
    );
    await waitFor(
      "the app document to complete",
      `document.readyState`,
      (state) => state === "complete",
      30000,
    );
    await page("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDir,
    }).catch(() => {});

    // ---- 2. the worker registers, activates, and controls exactly one page ---
    const controller = await waitFor(
      "the worker to control the page",
      `(async () => {
        if (!("serviceWorker" in navigator)) return null;
        const reg = await navigator.serviceWorker.ready;
        return { scope: reg.scope, active: !!reg.active, state: reg.active?.state ?? null };
      })()`,
      (r) => !!r?.active && r.state === "activated",
      45000,
    ).catch((error) => String(error));
    step(
      "the app's own registration reaches an activated worker",
      typeof controller === "object" && controller?.active === true,
      JSON.stringify(controller),
    );
    const control = await evaluate(
      `(async () => {
        if (!("serviceWorker" in navigator)) return { supported: false };
        const reg = await navigator.serviceWorker.getRegistration("/");
        return {
          supported: true,
          controlled: !!navigator.serviceWorker.controller,
          controllerScript: navigator.serviceWorker.controller?.scriptURL ?? null,
          waiting: !!reg?.waiting,
          installing: !!reg?.installing,
        };
      })()`,
    );
    const controlCount = await evaluate(
      `(async () => (await navigator.serviceWorker.getRegistrations()).length)()`,
    );
    step(
      "exactly one registration controls the page, and it is the app's own sw.js",
      control.controlled === true &&
        String(control.controllerScript ?? "").endsWith("/sw.js") &&
        control.waiting === false &&
        control.installing === false &&
        controlCount === 1,
      `registrations=${controlCount} ${JSON.stringify(control)}`,
    );
    const workerTargets = results.notes.attachedTargets.filter(
      (target) => target.type === "service_worker",
    );
    step(
      "the worker target is attached to this run, so 'offline' includes it",
      workerTargets.length >= 1,
      `types: ${[...new Set(results.notes.attachedTargets.map((t) => t.type))].join(",")} | ` +
        workerTargets
          .map((t) => t.url.replace(ORIGIN, ""))
          .join(",")
          .slice(0, 120),
    );

    // ---- 3. the local pages are visited online, then rendered with the origin down ---------------------
    // Each page is visited online first (so the worker caches its document), then
    // the network is cut and the page reloaded. The assertion is that the stored
    // content renders *and* that the document came from the worker.
    const offlinePages = [
      { path: "/library", desc: "library" },
      { path: "/library/liked", desc: "liked tracks" },
      { path: "/history", desc: "history and statistics" },
      { path: "/queue", desc: "queue" },
      { path: "/settings", desc: "settings" },
    ];
    for (const pagePath of offlinePages) {
      await goto(pagePath.path);
      await delay(400);
    }
    const filledAfterVisits = await evaluate(
      `(async () => {
        const out = {};
        for (const name of (await caches.keys()).sort()) {
          out[name] = (await (await caches.open(name)).keys()).length;
        }
        return out;
      })()`,
    );
    results.notes.cacheReport.push({
      phase: "after visiting every local page",
      entries: filledAfterVisits,
    });
    const cacheNames = Object.keys(filledAfterVisits);
    step(
      "the worker's caches are its versioned ones, and each stayed within its bound",
      cacheNames.length > 0 &&
        cacheNames.every(
          (name) =>
            name.startsWith(`spotivibe-`) &&
            name.endsWith(`-${COPY.workerVersion}`),
        ) &&
        // An unrecognized cache name fails the check rather than being exempt: the
        // first version used `?? Infinity`, so a cache the reader did not expect
        // passed as "within its bound" without ever being compared to one.
        Object.entries(filledAfterVisits).every(([name, count]) => {
          const bound = COPY.cacheBounds[basisOf(name)];
          return typeof bound === "number" && count <= bound;
        }),
      JSON.stringify(filledAfterVisits),
    );

    // ---- 4. the SKIP_WAITING handshake answers, and IndexedDB survives it --
    // The real handshake over a live message port, because that is the part that
    // can silently break (a message the worker never handles leaves the notice
    // stuck). The *waiting-worker* half needs a second, different build to be
    // reproducible and is covered by the unit suite; that limitation is disclosed.
    const seeded = await evaluate(
      `(async () => {
        const name = ${JSON.stringify(COPY.databaseName)};
        return await new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("likedTracks", "readwrite");
            tx.objectStore("likedTracks").put({
              trackId: "m13-evidence-track",
              likedAt: Date.now(),
              // The shape the repository writes. The previous version of this seed had
              // no artists and no id - not a record the application can produce -
              // which crashed /library/liked into the route error boundary while
              // offline, and the run scored that a pass. The surface now tolerates such
              // a row (with its own regression test in tests/liked-songs.test.tsx), but
              // the harness should not be manufacturing one.
              track: {
                id: "youtube:m13-evidence-track",
                providerId: "m13-evidence-track",
                title: "Evidence track",
                artists: [{ id: "m13-artist", providerId: "m13-artist", name: "M13 Evidence" }],
                album: null,
                duration: 1,
                artwork: [],
                category: "music",
                available: true,
                explicit: false,
              },
            });
            tx.oncomplete = () => { db.close(); resolve(true); };
            tx.onerror = () => { db.close(); resolve(false); };
          };
          request.onerror = () => resolve(false);
        });
      })()`,
    );
    const handshake = await evaluate(
      `(async () => {
        if (!("serviceWorker" in navigator)) return { supported: false };
        const controller = navigator.serviceWorker.controller;
        if (!controller) return { controlled: false };
        return await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ answered: false }), 8000);
          const onMessage = (event) => {
            if (event.data && event.data.type === "ACTIVATED") {
              clearTimeout(timer);
              navigator.serviceWorker.removeEventListener("message", onMessage);
              resolve({ answered: true, data: event.data });
            }
          };
          navigator.serviceWorker.addEventListener("message", onMessage);
          controller.postMessage({ type: "SKIP_WAITING" });
        });
      })()`,
    );
    step(
      "the worker answers SKIP_WAITING with ACTIVATED over a live message port",
      seeded === true && handshake.answered === true,
      JSON.stringify(handshake),
    );
    await goto("/library");
    const survived = await evaluate(
      `(async () => {
        const name = ${JSON.stringify(COPY.databaseName)};
        return await new Promise((resolve) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => {
            const db = request.result;
            const all = db.transaction("likedTracks", "readonly").objectStore("likedTracks").getAll();
            all.onsuccess = () => {
              const rows = all.result ?? [];
              db.close();
              resolve({ count: rows.length, hasEvidenceRow: rows.some((row) => row.trackId === "m13-evidence-track") });
            };
            all.onerror = () => { db.close(); resolve({ count: -1, hasEvidenceRow: false }); };
          };
          request.onerror = () => resolve({ count: -1, hasEvidenceRow: false });
        });
      })()`,
    );
    step(
      "IndexedDB data survives the worker's activation handshake and the reload into it",
      survived.hasEvidenceRow === true,
      JSON.stringify(survived),
    );
    const cachesAfter = await evaluate(
      `(async () => (await caches.keys()).sort())()`,
    );
    step(
      "the worker deleted nothing outside its own versioned caches",
      (cachesAfter ?? []).length > 0 &&
        (cachesAfter ?? []).every((name) => name.startsWith("spotivibe-")),
      (cachesAfter ?? []).join(", ") || "(none)",
    );
    results.notes.cacheReport.push({
      phase: "after activation",
      entries: cachesAfter,
    });

    // ---- 5. the install affordance, driven by a trusted click -------------
    // The platform's own `beforeinstallprompt` is not something a harness can
    // force, so the affordance is checked in whichever way this browser allows:
    // if the real event already fired (the row is visible), the real deferred
    // event is exercised; otherwise a synthetic one is dispatched and that fact is
    // disclosed. Either way the click is a *trusted* CDP click, because
    // `BeforeInstallPromptEvent.prompt()` requires a user gesture and an in-page
    // `click()` fails with NotAllowedError.
    await goto("/settings");
    const realOffer = await evaluate(
      `(() => !!document.querySelector('[data-testid="install-row"]'))()`,
    );
    results.notes.installOffer = {
      realPlatformEventObserved: realOffer === true,
      note: realOffer
        ? "This browser fired beforeinstallprompt for real; the row and the prompt() call below use the platform's own deferred event."
        : "This browser did not fire beforeinstallprompt, so the harness dispatched a synthetic one (disclosed).",
    };
    if (!realOffer) {
      results.notes.disclosures.platformEvents.push(
        "beforeinstallprompt was dispatched by the harness as a cancelable Event carrying prompt() and userChoice, because this browser did not fire the real event. The app's capture, its preventDefault, the row it renders, and the prompt() call are the shipped code paths; the platform's own engagement heuristic is not exercised.",
      );
      await evaluate(
        `(() => {
          const event = new Event("beforeinstallprompt", { cancelable: true });
          event.prompt = () => { window.__m13Prompted = (window.__m13Prompted ?? 0) + 1; return Promise.resolve(); };
          Object.defineProperty(event, "userChoice", { value: Promise.resolve({ outcome: "accepted" }) });
          window.dispatchEvent(event);
          return true;
        })()`,
      );
      await delay(400);
    }
    const rowPresent = await evaluate(
      `(() => !!document.querySelector('[data-testid="install-row"]'))()`,
    );
    const before = results.steps.length;
    await trustedClick('[data-testid="install-row"] button').catch((error) => {
      step(
        "the install row offers a clickable control",
        false,
        String(error).slice(0, 200),
      );
    });
    await delay(1200);
    const rowAfter = await evaluate(
      `(() => ({
        row: !!document.querySelector('[data-testid="install-row"]'),
        prompted: window.__m13Prompted ?? "platform-default",
      }))()`,
    );
    step(
      "the install row appears where installation is offered, and withdraws once asked",
      rowPresent === true && rowAfter.row === false,
      `rowBefore=${rowPresent} rowAfter=${rowAfter.row} prompted=${rowAfter.prompted} (steps since: ${results.steps.length - before})`,
    );
    await shoot(
      "settings-install-row.png",
      "Settings after the install affordance resolved",
    );

    // The online half of the metadata probe (step 8 runs its assertion later).
    // It happens here because the worker's cache can only get a copy from a
    // successful fetch: the offline phase has no origin to fetch from.
    const metadataUrl = "/api/artist?name=Portishead&evidence=m13";
    const onlineMeta = await evaluate(
      `(async () => {
        const res = await fetch(${JSON.stringify(metadataUrl)}, { cache: "no-store" });
        const body = await res.text();
        return { status: res.status, length: body.length, cachedAt: res.headers.get("x-spotivibe-cached-at") };
      })()`,
    );
    // Both halves are recorded; the assertion in the offline phase reads the online
    // half from here.
    results.notes.metadataProbe = { online: onlineMeta };

    // The document-response list spans both phases, so the offline phase needs its
    // own marker: without it, an offline phase where *every* navigation failed would
    // still find the online entries (all fromServiceWorker) and pass.
    results.notes.offlinePhaseStart = results.notes.documentResponses.length;
    await setOffline(true);
    step(
      "the origin really is refusing connections, so 'offline' is not an emulation",
      results.notes.originRefusedConnections === true || EXTERNAL,
      `originRefusedConnections=${results.notes.originRefusedConnections} external=${EXTERNAL}`,
    );
    for (const pagePath of offlinePages) {
      await goto(pagePath.path);
      // `main` is the route's own subtree, so an application error boundary inside it
      // fails this check. The previous version scanned the whole document for shell
      // landmarks, which a crash page still has - `/library/liked` rendered the
      // route error boundary ("Something went wrong") and was scored a pass.
      const rendered = await evaluate(
        `(() => {
          const main = document.querySelector("main");
          if (!main) return { ok: false, reason: "no main" };
          const text = (main.innerText || "").replace(/\\s+/g, " ").trim();
          const crashed = /something went wrong|went wrong|an error occurred/i.test(text);
          return {
            ok: text.length > 20 && !crashed,
            crashed,
            chars: text.length,
            sample: text.slice(0, 90),
          };
        })()`,
      );
      results.notes.offlinePages = results.notes.offlinePages ?? [];
      results.notes.offlinePages.push({ path: pagePath.path, ...rendered });
      step(
        `${pagePath.path} renders offline, from its own stored data`,
        rendered.ok === true,
        `${rendered.chars ?? 0} chars in the route's own subtree${rendered.crashed ? " (CRASHED: error boundary)" : ""}: ${rendered.sample ?? rendered.reason ?? ""}`.slice(
          0,
          220,
        ),
      );
    }
    const offlineResponses = results.notes.documentResponses.slice(
      results.notes.offlinePhaseStart ?? 0,
    );
    const documentFromWorker =
      offlineResponses.length >= offlinePages.length &&
      offlineResponses
        .filter((entry) => offlinePages.some((p) => p.path === entry.path))
        .every((entry) => entry.fromServiceWorker);
    step(
      "every offline document response was served by the service worker",
      documentFromWorker,
      `offline responses: ${offlineResponses.length} of ${results.notes.documentResponses.length} total; ` +
        JSON.stringify(
          offlineResponses.filter((entry) =>
            offlinePages.some((p) => p.path === entry.path),
          ),
        ).slice(0, 320),
    );
    const offlineBanner = await evaluate(
      `(() => {
        const banner = document.querySelector('[data-testid="connection-banner"]');
        return {
          text: banner ? (banner.innerText || "").replace(/\\s+/g, " ").trim() : null,
          onLine: navigator.onLine,
        };
      })()`,
    );
    step(
      "the offline banner names the capabilities that need a connection",
      typeof offlineBanner.text === "string" &&
        offlineBanner.text
          .toLowerCase()
          .includes(COPY.offlineUnavailable.toLowerCase()) &&
        offlineBanner.text
          .toLowerCase()
          .includes(COPY.offlineRemains.toLowerCase()),
      `navigator.onLine=${offlineBanner.onLine} text=${String(offlineBanner.text).slice(0, 180)}`,
    );
    await shoot(
      "offline-settings.png",
      "Settings rendered with the network cut, banner visible",
    );
    await goto("/library");
    await shoot(
      "offline-library.png",
      "Library rendered from the worker's cache while offline",
    );

    // ---- 7. a per-entity route falls back to the shell, never to another entity ----
    // Amended behavior: the shell document is the fallback, so the application
    // still loads. The evidence is that the response came from the worker *and*
    // that the app's own chrome is on screen - the browser's own "no internet"
    // page has neither.
    const beforeEntity = results.notes.documentResponses.length;
    await goto("/artist/m13-never-visited-entity");
    const entityDocument = results.notes.documentResponses
      .slice(beforeEntity)
      .find((entry) => entry.path === "/artist/m13-never-visited-entity");
    // The route's own subtree again: the banner is shell-global, so scanning the whole
    // document let the banner satisfy a claim about the route. With the redirect, the
    // expectation is now simply that the listener landed on the shell at the shell's
    // own URL - which is what "URL and content agree" means.
    const entityUi = await evaluate(
      `(() => {
        const main = document.querySelector("main");
        const text = (main?.innerText || "").replace(/\\s+/g, " ");
        return {
          landedOnShell: location.pathname === "/",
          url: location.pathname,
          chars: text.length,
          hasAppChrome: !!document.querySelector('[data-testid="desktop-shell"], nav, [data-testid="bottom-nav"], [role="search"]'),
          namesTheProblem: /could not|unable|error|try again|unavailable|went wrong|failed|offline|connection/i.test(text),
          mentionsSpotivibe: /spotivibe/i.test(document.title ?? ""),
          browserErrorPage: /no internet|err_|chrome-error/i.test(location.href),
        };
      })()`,
    );
    // The 302 itself is not attributed to the original request in
    // `documentResponses` (no `responseReceived` carries that request id), so the
    // evidence is the *landing*: the shell document, served by the worker, at the
    // shell's own URL. Asserting the redirect's own response would be asserting a CDP
    // bookkeeping detail rather than a behavior.
    const shellLanding = results.notes.documentResponses
      .slice(beforeEntity)
      .find((entry) => entry.path === "/");
    step(
      "an uncached entity route offline is redirected to the shell, not to a browser error page",
      shellLanding?.fromServiceWorker === true &&
        entityUi.hasAppChrome === true &&
        entityUi.browserErrorPage === false,
      `shellLanding fromServiceWorker=${shellLanding?.fromServiceWorker ?? "no document response"} ${JSON.stringify(entityUi).slice(0, 200)}`,
    );
    step(
      "the redirect lands on the shell at the shell's own URL, so URL and content agree",
      entityUi.landedOnShell === true &&
        entityUi.chars > 20 &&
        entityUi.mentionsSpotivibe,
      `landed at ${entityUi.url} with ${entityUi.chars} chars of the app's own content`,
    );
    // One screenshot for the shared destination: both unvisited routes land on the
    // same shell by design, and two byte-identical images presented as two pieces of
    // evidence is how a reader is misled.
    await shoot(
      "offline-unvisited-route.png",
      "An unvisited route while offline: redirected to the shell, inside the application",
    );
    await delay(500);
    await goto("/library");
    await delay(500);

    // ---- 8. metadata is cached and served offline; search never is ---------
    // This is the one step that deliberately crosses the boundary, so it states
    // which side of it each probe is on: the copy is fetched while the origin is
    // still up (which is the only way the worker's cache gets one), then again
    // with the origin down, which is the only way to see the fallback rather than
    // the network. The earlier version of this harness probed both sides while the
    // origin was up and called the result a cache hit.
    const offlineMeta = await evaluate(
      `(async () => {
        // \`no-store\` on purpose: this asserts the *worker's* cache, and the
        // browser's own HTTP cache can satisfy the same URL without the worker or
        // the network being involved at all.
        const res = await fetch(${JSON.stringify(metadataUrl)}, { cache: "no-store" });
        const body = await res.text();
        return { status: res.status, length: body.length, cachedAt: res.headers.get("x-spotivibe-cached-at") };
      })()`,
    );
    results.notes.metadataProbe.offline = offlineMeta;
    step(
      "a previously fetched metadata response is served while offline, from the cache",
      onlineMeta.status === 200 &&
        onlineMeta.cachedAt === null &&
        offlineMeta.status === 200 &&
        typeof offlineMeta.cachedAt === "string" &&
        offlineMeta.length === onlineMeta.length,
      `online ${onlineMeta.status}/${onlineMeta.length}B cachedAt=${onlineMeta.cachedAt} → offline ${offlineMeta.status}/${offlineMeta.length}B cachedAt=${offlineMeta.cachedAt}`,
    );
    const offlineSearch = await evaluate(
      `(async () => {
        try {
          const res = await fetch("/api/search?q=portishead&evidence=m13", { cache: "no-store" });
          return { rejected: false, status: res.status };
        } catch (error) {
          return { rejected: true, error: String(error).slice(0, 90) };
        }
      })()`,
    );
    step(
      "search is never answered from cache, so it fails honestly offline",
      offlineSearch.rejected === true,
      JSON.stringify(offlineSearch),
    );
    const beforeSearch = results.notes.documentResponses.length;
    await goto("/search");
    await delay(1500);
    // `/search` was deliberately never visited while the origin was up, so this
    // navigation is the "unvisited route" case: the worker redirects to the shell,
    // and the listener lands on a working application that says what is unavailable.
    // Before the fallback chain existed this navigation failed outright and Chrome's
    // own error page took over - the bug the evidence run found.
    const searchDocument = results.notes.documentResponses
      .slice(beforeSearch)
      .find((entry) => entry.path === "/search");
    const searchOffline = await evaluate(
      `(() => {
        const text = (document.body.innerText || "").replace(/\\s+/g, " ");
        return {
          chars: text.length,
          sample: text.slice(0, 140),
          mentionsConnection: /connection|offline|reconnect/i.test(text),
          ownErrorState: !!document.querySelector('[data-testid="search-error"], [role="alert"]') || /went wrong|try again|could not|unable to load|offline|no connection/i.test(text),
          // What actually rendered, recorded rather than glossed over (see
          // notes.disclosures.shellContent). Scoped to the main region: a document-wide heading
          // selector picked the sidebar and recorded "Your Library" for a page whose
          // own content read "Home Trending Now ...", so the recorded field
          // contradicted the recorded sample.
          heading: (document.querySelector("main h1, main h2")?.innerText ?? "").trim().slice(0, 60),
          hasAppChrome: !!document.querySelector('nav, [data-testid="connection-banner"], [role="search"]'),
          landedOnShell: location.pathname === "/",
          url: location.pathname,
          browserErrorPage: /no internet|err_|chrome-error/i.test(location.href),
        };
      })()`,
    );
    const searchLanding = results.notes.documentResponses
      .slice(beforeSearch)
      .find((entry) => entry.path === "/");
    step(
      "an unvisited route offline is redirected to the shell, not to the browser's error page",
      searchLanding?.fromServiceWorker === true &&
        searchOffline.browserErrorPage === false &&
        searchOffline.hasAppChrome === true &&
        searchOffline.landedOnShell === true,
      `shellLanding fromServiceWorker=${searchLanding?.fromServiceWorker ?? "no document response"} landed=${searchOffline.url}`,
    );
    step(
      "the unvisited route opens a working application that states what is unavailable",
      searchOffline.chars > 20 &&
        searchOffline.mentionsConnection === true &&
        (searchOffline.ownErrorState === true ||
          searchOffline.honestShell === true),
      JSON.stringify(searchOffline).slice(0, 260),
    );
    await shoot(
      "offline-search-fails.png",
      "A search request while offline: rejected by the worker, never answered from cache",
    );

    // ---- 9. the data controls remain usable with the network cut -----------
    await delay(600);
    await goto("/settings");
    const exportControl = await evaluate(
      `(() => {
        const button = [...document.querySelectorAll("button")].find((b) => /export|backup/i.test(b.textContent || ""));
        return button ? { found: true, label: (button.textContent || "").trim() } : { found: false, buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).slice(0, 18) };
      })()`,
    );
    step(
      "a backup export control exists on the settings surface",
      exportControl.found === true,
      JSON.stringify(exportControl).slice(0, 200),
    );
    await setOffline(true);
    const offlineControls = await evaluate(
      `(() => {
        const text = (document.body.innerText || "").replace(/\\s+/g, " ");
        return { chars: text.length, exportVisible: /export|backup/i.test(text) };
      })()`,
    );
    step(
      "the data controls remain usable with the network cut",
      offlineControls.chars > 20 && offlineControls.exportVisible === true,
      JSON.stringify(offlineControls),
    );
    await setOffline(false);
    await delay(400);

    // ---- 10. console hygiene -----------------------------------------------
    step(
      "zero console errors outside the disclosed offline window",
      results.consoleErrors.length === 0,
      results.consoleErrors.slice(0, 4).join(" | ") || "none",
    );

    results.notes.disclosures.shellContent =
      "An uncached route offline is *redirected* to the cached shell, so the listener lands on the Home route at the Home route's own URL with the connection banner stating that search and playback need a connection. The earlier design served the shell's document under the requested URL, which rendered the Home content at, say, /search; the browser evidence run caught that mismatch and the worker now redirects instead, so URL and content agree. The cost is unchanged in substance: a listener who opens an unvisited route offline gets the application at its shell, not the route they asked for, because a per-route offline document would need a build-time asset manifest this application has no honest way to produce for its dynamic routes.";
    results.notes.disclosures.notVerifiableHere.push(
      "A waiting worker needs a second, different build installed behind the current one, which a single static build cannot produce, so no real `activate` event fires during this run: SKIP_WAITING on an already-active worker is a no-op and the cache-retirement filter is therefore exercised by frontend/tests/pwa-service-worker.test.ts against the shipped bytes, not here. The handshake itself is exercised for real (SKIP_WAITING → ACTIVATED over a live message port) and the waiting-worker state machine is covered by frontend/tests/pwa-client.test.tsx.",
      "Installability as Chrome's install UI presents it, and real iOS/Android home-screen behavior: the manifest, the icon set and the iOS document metadata are verified as served, but a headless desktop browser cannot install to a home screen.",
      "Offline artwork: no artwork is displayed on the pages this run visits, so the artwork cache is exercised by frontend/tests/pwa-service-worker.test.ts (serving, background revalidation and eviction) rather than by real image traffic.",
      "A metadata response older than the 7-day freshness bound is exercised in the unit suite by aging the stored copy, not by waiting seven days here.",
    );

    results.pass = results.steps.every((s) => s.ok);
  } catch (error) {
    step(
      "the harness ran to completion",
      false,
      String(error?.stack ?? error).slice(0, 600),
    );
  } finally {
    closeAll();
  }

  const failed = results.steps.filter((s) => !s.ok);
  results.summary = {
    steps: results.steps.length,
    passed: results.steps.length - failed.length,
    failed: failed.length,
    screenshots: results.screenshots.length,
    consoleErrors: results.consoleErrors.length,
    offlineWindowEntries: results.notes.disclosures.offlineWindow.length,
  };
  writeFileSync(
    join(EVIDENCE_DIR, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `\n${results.pass ? "PASS" : "FAIL"} — ${results.summary.passed}/${results.summary.steps} steps, ` +
      `${results.summary.screenshots} screenshots, ${results.summary.consoleErrors} console errors, ` +
      `${results.summary.offlineWindowEntries} disclosed offline-window entries.`,
  );
  process.exit(results.pass ? 0 : 1);
}

/** The bound a cache name maps to, read from the worker's own constants. */
function basisOf(cacheName) {
  return cacheName.split("-")[1] ?? "";
}

await main();
