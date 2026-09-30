/**
 * The browser-driving plumbing, written once (M15 task 2.1).
 *
 * Thirteen milestones each wrote their own copy of this, and every copy was archived with
 * its change, so none of them ran. This is the maintained one: a release suite that is
 * rebuilt per release is not a suite. The archived harnesses stay where they are as the
 * record of the runs that produced their evidence.
 *
 * It owns four things, and nothing else:
 *
 * 1. the production server's lifecycle, including the Windows teardown that M13 recorded
 *    as necessary (`taskkill /T /F`, because killing the spawned process alone does not
 *    free the port);
 * 2. the browser's lifecycle, with a fresh profile so a run is cold;
 * 3. one page session, attached at the browser endpoint because page domains do not exist
 *    on it;
 * 4. **request interception**, so provider responses come from recorded fixtures and a run
 *    neither depends on a third party nor changes when one is rate-limiting.
 *
 * The flows themselves live in `end-to-end.mjs` and know nothing about any of this.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Browser executables, in the order they are tried.
 *
 * Chromium first because it is the protocol's reference implementation and therefore the
 * one most likely to be present; Edge second because it speaks the same protocol and is
 * installed by default on Windows, which makes the second-engine run free rather than
 * conditional. Firefox is absent deliberately and not by oversight: it does not speak
 * this protocol, which is why the browser matrix lists it as a manual entry.
 */
export const BROWSER_CANDIDATES = {
  // Forward slashes throughout: Windows accepts them in both `existsSync` and `spawn`, and
  // they cannot be double-escaped by accident. The first version of this list wrote
  // backslashes in a JavaScript string literal, which produced paths containing a literal
  // backslash-backslash and found no browser at all.
  chromium: [
    process.env.SPOTIVIBE_CHROMIUM_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean),
  edge: [
    process.env.SPOTIVIBE_EDGE_PATH,
    process.env.SPOTIVIBE_BROWSER_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean),
};
/**
 * Which engines are actually installed here.
 *
 * Reported rather than assumed, because "the suite ran in two browsers" and "the suite can
 * be pointed at a second browser" are different claims. This machine has one engine
 * installed, and the suite says so rather than reporting coverage it does not have.
 */
export function availableEngines() {
  const found = [];
  for (const [engine, candidates] of Object.entries(BROWSER_CANDIDATES)) {
    const executable = candidates.find((candidate) => existsSync(candidate));
    if (executable) found.push({ engine, executable });
  }
  return found;
}

/** The first installed engine, which is what a run uses when none is named. */
export function defaultEngine() {
  const [first] = availableEngines();
  return first?.engine ?? "chromium";
}

export function findBrowser(engine = "chromium") {
  const candidates = BROWSER_CANDIDATES[engine];
  if (!candidates) throw new Error(`Unknown browser engine: ${engine}`);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `No ${engine} executable found. Tried:\n  ${candidates.join("\n  ")}\n` +
        "Set SPOTIVIBE_BROWSER_PATH to override.",
    );
  }
  return found;
}

/** Start `next start` against an existing production build. */
function startServer(frontend, port, logPath) {
  const child = spawn(
    process.execPath,
    [
      join(frontend, "node_modules", "next", "dist", "bin", "next"),
      "start",
      "-p",
      String(port),
    ],
    {
      cwd: frontend,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  const stream = createWriteStream(logPath, { flags: "a" });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  return child;
}

/** Kill the process *tree*. On Windows, killing the process alone leaves the port bound. */
export function stopServer(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

async function waitFor(origin, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${origin}/manifest.webmanifest`)).ok) return true;
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
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await delay(250);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

/**
 * A live session: a production server, a browser, one page, and a fixture router.
 */
export async function openSession({
  repo,
  port = 3213,
  cdpPort = 9466,
  engine = "chromium",
  viewport = { width: 1280, height: 900, mobile: false },
} = {}) {
  const frontend = join(repo, "frontend");
  const origin = `http://localhost:${port}`;
  if (!existsSync(join(frontend, ".next"))) {
    throw new Error(
      "No production build found — run `cd frontend && npm run build` first.",
    );
  }

  const profileDir = mkdtempSync(join(tmpdir(), `spotivibe-e2e-${engine}-`));
  const serverLog = join(tmpdir(), `spotivibe-e2e-${port}.log`);
  let server;
  let browser;
  let ws;
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  const sessions = new Map();
  let wantedTargetId = "";
  const routes = [];
  let routerPaused = false;

  const pageSession = () => sessions.get(wantedTargetId) ?? "";

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

  try {
    server = startServer(frontend, port, serverLog);
    if (!(await waitFor(origin))) {
      throw new Error(
        `Production server not reachable at ${origin}. See ${serverLog}.`,
      );
    }

    // The browser is launched *before* its version endpoint is read. The first version of
    // this harness read it first, so it waited thirty seconds for a browser that had not
    // been started yet, and reported a timeout that looked like a CDP problem rather than
    // an ordering mistake.
    browser = spawn(
      findBrowser(engine),
      [
        "--headless=new",
        `--remote-debugging-port=${cdpPort}`,
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
      `http://127.0.0.1:${cdpPort}/json/version`,
    );

    ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
      ws.onopen = resolveOpen;
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
        return;
      }
      for (const listener of listeners) listener(message);
    };
    const on = (method, handler) =>
      listeners.push(
        (message) =>
          message.method === method &&
          handler(message.params, message.sessionId),
      );

    // Page domains do not exist on the browser endpoint, and the worker reports its own
    // network traffic on its own session - so the page session is resolved by target id
    // and `Network` is enabled wherever traffic is reported.
    const pageTarget = await sendTo("", "Target.createTarget", {
      url: "about:blank",
    });
    wantedTargetId = pageTarget.targetId;
    on("Target.attachedToTarget", async (params) => {
      sessions.set(String(params.targetInfo?.targetId ?? ""), params.sessionId);
      try {
        if (params.targetInfo?.type === "service_worker") {
          await sendTo(params.sessionId, "Network.enable");
          return;
        }
        if (params.targetInfo?.type !== "page") return;
        await sendTo(params.sessionId, "Page.enable");
        await sendTo(params.sessionId, "Runtime.enable");
        await sendTo(params.sessionId, "Network.enable");
      } catch {
        /* a target that closed before its domains were enabled is not a failure */
      }
    });
    await sendTo("", "Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    const attachDeadline = Date.now() + 20000;
    while (!pageSession() && Date.now() < attachDeadline) await delay(200);
    if (!pageSession()) throw new Error("The application page never attached.");

    const send = (method, params = {}) => sendTo(pageSession(), method, params);

    const consoleErrors = [];
    on("Runtime.consoleAPICalled", (params, sessionId) => {
      if (params.type !== "error" || sessionId !== pageSession()) return;
      consoleErrors.push(
        `console.error: ${params.args
          .map((a) => a.value ?? a.description ?? "")
          .join(" ")
          .slice(0, 240)}`,
      );
    });
    on("Runtime.exceptionThrown", (params, sessionId) => {
      if (sessionId !== pageSession()) return;
      consoleErrors.push(
        `exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`.slice(
          0,
          240,
        ),
      );
    });

    /**
     * The fixture router.
     *
     * Requests are paused and answered from `routes`, so a run is reproducible and does
     * not depend on any third party. A path with no route is **continued** rather than
     * failed, so the application's own static assets and documents flow normally — the
     * router is here to stand in for the providers, not to stand in for the application.
     */
    on("Fetch.requestPaused", async (params, sessionId) => {
      if (sessionId !== pageSession() || !routerPaused) return;
      const { requestId, request } = params;
      const url = new URL(request.url);
      const route = routes.find(
        (entry) =>
          entry.path === url.pathname ||
          (entry.match && entry.match.test(url.pathname)),
      );
      try {
        if (!route) {
          await sendTo(sessionId, "Fetch.continueRequest", { requestId });
          return;
        }
        // A route can fail in two genuinely different ways, and the first version could
        // only express one of them.
        //
        // `transport: "failed"` is a connection-level failure — the server never answered.
        // A bare `status >= 400` used to mean this, which meant the `ok: false` bodies the
        // failing fixtures carry were dead data: every failure arrived as a transport
        // error and the application never saw the failure *shape* its own routes produce.
        // The fixtures exist to model that shape, so a route that declares a `status` is
        // served that status, and only a route that declares `transport: "failed"` fails at
        // the connection level. The two are now expressible separately, and the
        // provider-failure scenario uses both.
        if (route.transport === "failed") {
          await sendTo(sessionId, "Fetch.failRequest", {
            requestId,
            errorReason: route.errorReason ?? "Failed",
          });
          return;
        }
        const body =
          typeof route.body === "function"
            ? route.body(url)
            : JSON.stringify(route.body);
        await sendTo(sessionId, "Fetch.fulfillRequest", {
          requestId,
          responseCode: route.status ?? 200,
          responseHeaders: [
            { name: "content-type", value: "application/json; charset=utf-8" },
            { name: "access-control-allow-origin", value: "*" },
          ],
          body: Buffer.from(body ?? "", "utf8").toString("base64"),
        });
      } catch (error) {
        // A router that throws must not hang the request: fall through to the network so
        // the failure shows up as the application's own behaviour rather than a stall.
        try {
          await sendTo(sessionId, "Fetch.continueRequest", { requestId });
        } catch {
          /* the request is already resolved */
        }
        consoleErrors.push(`fixture router: ${String(error)}`);
      }
    });

    const session = {
      origin,
      engine,
      browser: version.Browser ?? "unknown",
      userAgent: version["User-Agent"] ?? "unknown",
      consoleErrors,
      serverLog,

      /** Route a same-origin API path to a recorded body. Later routes win. */
      route(entry) {
        routes.push(entry);
      },
      /** Remove every route, so a scenario can start from a known state. */
      clearRoutes() {
        routes.length = 0;
      },

      /**
       * Take the origin down, and bring it back.
       *
       * The offline flow needs a *genuinely* unreachable origin rather than an emulated
       * one. M13 recorded that as the only definition worth trusting, because a simulated
       * offline mode can still be served from a renderer cache - and a flow that thinks it
       * is offline while the server is answering proves nothing.
       */
      async stopOrigin() {
        stopServer(server);
        server = undefined;
        await delay(600);
        // Proof rather than assumption: the origin must actually refuse a connection.
        const outcome = await fetch(`${origin}/manifest.webmanifest`, {
          cache: "no-store",
        })
          .then(() => "answered")
          .catch(() => "refused");
        if (outcome !== "refused") {
          throw new Error(
            `the origin still answered after being stopped (${outcome})`,
          );
        }
        return outcome;
      },

      async startOrigin() {
        server = startServer(frontend, port, serverLog);
        if (!(await waitFor(origin))) {
          throw new Error(
            `the origin did not come back up at ${origin}. See ${serverLog}.`,
          );
        }
        return true;
      },

      async setViewport(next) {
        await send("Emulation.setDeviceMetricsOverride", {
          width: next.width,
          height: next.height,
          deviceScaleFactor: 1,
          mobile: next.mobile,
        });
      },

      /** Start intercepting. Called once; flows then see the router. */
      async startRouting() {
        if (routerPaused) return;
        await send("Fetch.enable", {
          patterns: [{ urlPattern: `${origin}/*` }],
        });
        routerPaused = true;
      },

      async evaluate(expression) {
        const response = await send("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (response.exceptionDetails) {
          throw new Error(
            response.exceptionDetails.exception?.description ??
              "evaluate failed",
          );
        }
        return response.result.value;
      },

      async waitFor(description, expression, predicate, timeoutMs = 20000) {
        const started = Date.now();
        let last = null;
        while (Date.now() - started < timeoutMs) {
          try {
            last = await session.evaluate(expression);
            if (predicate(last)) return last;
          } catch {
            /* navigation in flight */
          }
          await delay(150);
        }
        throw new Error(
          `Timed out waiting for ${description} (last: ${JSON.stringify(last)})`,
        );
      },

      async goto(path) {
        await send("Page.navigate", { url: `${origin}${path}` });
        await session.waitFor(
          `${path} ready`,
          "document.readyState",
          (value) => value === "complete" || value === true,
          30000,
        );
        // A moment for hydration and the first effects, so a flow does not assert against
        // a page that has not finished starting.
        await delay(600);
      },

      async click(selector, { trusted = true } = {}) {
        // A trusted click by default: an in-page `element.click()` is not a user gesture,
        // and several browser behaviours (install prompts, some menus) require one.
        if (trusted) {
          const box = await session.evaluate(`(() => {
            const element = document.querySelector(${JSON.stringify(selector)});
            if (!element) return null;
            element.scrollIntoView({ block: "center" });
            const rect = element.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          })()`);
          if (!box) throw new Error(`No element for ${selector}`);
          for (const type of ["mousePressed", "mouseReleased"]) {
            await send("Input.dispatchMouseEvent", {
              type,
              x: box.x,
              y: box.y,
              button: "left",
              clickCount: 1,
            });
          }
          return;
        }
        await session.evaluate(
          `document.querySelector(${JSON.stringify(selector)}).click(); true`,
        );
      },

      async type(selector, text) {
        await session.click(selector);
        for (const character of text) {
          await send("Input.dispatchKeyEvent", {
            type: "keyDown",
            text: character,
          });
          await send("Input.dispatchKeyEvent", {
            type: "keyUp",
            text: character,
          });
        }
      },

      async press(key) {
        await send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key,
          code: key,
          windowsVirtualKeyCode:
            key === "Enter" ? 13 : key === "Escape" ? 27 : 0,
        });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key });
      },

      /**
       * Capture a PNG and write it into the evidence directory.
       *
       * Written rather than returned, because a screenshot nobody opens is not evidence:
       * handing base64 to a caller that never saved it is how task 6.3 came to ask for
       * screenshots while the directory contained none.
       */
      async screenshot(name, directory) {
        const { data } = await send("Page.captureScreenshot", {
          format: "png",
        });
        const file = join(directory, `${name}.png`);
        writeFileSync(file, Buffer.from(data, "base64"));
        return file;
      },

      async count(selector) {
        return session.evaluate(
          `document.querySelectorAll(${JSON.stringify(selector)}).length`,
        );
      },

      async close() {
        routerPaused = false;
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
        stopServer(server);
        server = undefined;
        await delay(300);
        try {
          rmSync(profileDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      },
    };

    await session.setViewport(viewport);
    return session;
  } catch (error) {
    stopServer(server);
    throw error;
  }
}

export function repoRoot(evidenceDir) {
  return resolve(evidenceDir, "../../../..");
}
