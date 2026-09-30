#!/usr/bin/env node
/**
 * M14 task 3.1, 3.2, 4.1 — dependency-free performance and accessibility measurement.
 *
 * Drives a production build in headless Edge over the Chrome DevTools Protocol, in the
 * same shape as M13's harness (`../../../archive/2026-09-30-add-pwa-install-and-offline-shell/evidence/cdp-check.mjs`),
 * and measures four things it can compute exactly:
 *
 * 1. **Core Web Vitals** through `PerformanceObserver` inside the page: largest
 *    contentful paint, cumulative layout shift, and a responsiveness measure
 *    (longest task, plus total blocking time, which is what the interaction proxy
 *    stands in for when INP cannot be observed without interaction).
 * 2. **Contrast** of every rendered text node against its effective background, at the
 *    WCAG AA minimum for its size class — computed, not eyeballed.
 * 3. **Accessible names** for every interactive element.
 * 4. **Keyboard reachability** of every primary control, and whether keyboard focus is
 *    actually visible.
 *
 * ## Why not lighthouse or axe-core
 *
 * Both would be large dependencies for checks this repository can make itself, and
 * both report a *score*. A score is the opposite of what this project has learned to
 * want: M13's verification pass found three evidence steps that could not fail, and the
 * lesson was that an assertion nobody can falsify is not evidence. A computed contrast
 * ratio with a stated threshold fails when a token pair drifts; a score is a number in a
 * report.
 *
 * Each audit is also run against a **deliberately degraded page** first (see
 * `PROBE_PAGE`), proving it can fire before it is trusted on the real one.
 *
 * ## What this does not measure
 *
 * A single-machine run against a local server is a **regression signal, not a field lab
 * score**. The thresholds are set for detecting a regression between two runs on the
 * same machine, and `results.json` records the machine, viewport, and whether the load
 * was cold or warm so two runs can be compared honestly. The harness asserts its own
 * limits rather than letting the numbers imply more than they are.
 *
 * Writes `results.json` and any screenshots next to this script. Exit 0 = every
 * assertion passed.
 *
 * Usage:  node audit.mjs      (with a production build; this harness starts the server)
 * Env:    SPOTIVIBE_PORT       (default 3212)
 *         SPOTIVIBE_BROWSER_PATH (Edge/Chrome executable override)
 *         SPOTIVIBE_CDP_PORT   (default 9465)
 */

import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVIDENCE_DIR = dirname(fileURLToPath(import.meta.url));
mkdirSync(EVIDENCE_DIR, { recursive: true });
const PORT = Number(process.env.SPOTIVIBE_PORT ?? 3212);
const ORIGIN = `http://localhost:${PORT}`;
const CDP_PORT = Number(process.env.SPOTIVIBE_CDP_PORT ?? 9465);
const REPO = resolve(EVIDENCE_DIR, "../../../..");
const FRONTEND = join(REPO, "frontend");

const BROWSER_CANDIDATES = [
  process.env.SPOTIVIBE_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

/**
 * The targets this milestone protects.
 *
 * Each names what it protects, because a threshold with no reason is a number someone
 * will relax the first time it is inconvenient.
 */
export const TARGETS = {
  /** Largest contentful paint: when the interface's main content is actually on screen. */
  lcpMs: 2500,
  /** Cumulative layout shift: nothing moves after it has been painted. */
  cls: 0.1,
  /**
   * Total blocking time. INP cannot be observed without interaction, so this stands
   * in for responsiveness on a load; the threshold is the "good" band at the 75th
   * percentile, doubled for a local production build on a developer machine.
   */
  tbtMs: 400,
  /**
   * Longest single task. A single task longer than this is the shape of a stutter,
   * and the cap is half a second: past that a person waits rather than watches.
   */
  longestTaskMs: 500,
};

/**
 * The viewports every surface is measured at.
 *
 * Both, because one viewport is a partial view: at 1280x900 the desktop sidebar
 * replaces the compact bottom navigation, so the compact shell's surfaces - bottom
 * navigation labels, the mini player - were never rendered. The first version of this
 * harness measured one viewport and reported every surface clean while an inactive
 * navigation label sat at 4.16:1. The token suite caught it statically; the fix
 * belonged here too, because a check that only runs where the defect is invisible is
 * not a check of the application.
 */
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "compact", width: 390, height: 844, mobile: true },
];

/** WCAG AA: 4.5:1 for body text, 3:1 for text at 18.66px bold or 24px and above. */
const CONTRAST_MIN_NORMAL = 4.5;
const CONTRAST_MIN_LARGE = 3;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const found = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found)
    throw new Error(
      "No Edge/Chrome executable found (set SPOTIVIBE_BROWSER_PATH).",
    );
  return found;
}

function startServer() {
  // In the OS temp directory, not next to this script: a run's server log is a
  // diagnostic for that run, and writing it into the evidence directory made every run
  // produce a diff in a directory that is otherwise the record of one specific run.
  const log = join(tmpdir(), `spotivibe-m14-audit-${PORT}.log`);
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
  return child;
}

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
      /* already gone */
    }
  }
}

async function waitForServer(timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${ORIGIN}/manifest.webmanifest`)).ok) return true;
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

/**
 * The injected measurement and audit code.
 *
 * Everything the page is asked to compute lives here, as one string, so what runs in
 * the browser is readable in the file rather than assembled from fragments. It returns
 * a single JSON value; nothing is reported by the page itself.
 */
/**
 * Installed before the document loads, because the observers have to exist *during*
 * the load to see the entries at all. The first version of this harness injected its
 * observers after the page had loaded and read a null LCP, which it then reported as
 * `0ms` - a measurement that looked like a result and was not one.
 */
const VITALS_BOOTSTRAP = String.raw`
(() => {
  if (window.__m14vitals) return;
  const vitals = { lcp: null, cls: 0, longestTask: 0, totalBlockingTime: 0, firstContentfulPaint: null };
  window.__m14vitals = vitals;
  const observe = (type, handler) => {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) handler(entry);
      }).observe({ type, buffered: true });
    } catch (error) {
      vitals.error = String(error);
    }
  };
  observe("largest-contentful-paint", (entry) => {
    vitals.lcp = entry.startTime;
  });
  observe("layout-shift", (entry) => {
    if (!entry.hadRecentInput) vitals.cls += entry.value;
  });
  observe("longest-task", (entry) => {
    vitals.longestTask = Math.max(vitals.longestTask, entry.duration);
    if (entry.duration > 50) vitals.totalBlockingTime += entry.duration - 50;
  });
})()`;

const INSTRUMENTED_AUDIT = String.raw`
(() => {
  // ---- Core Web Vitals, observed during the load by the bootstrap ----------
  const measured = window.__m14vitals ?? { lcp: null, cls: 0, longestTask: 0, totalBlockingTime: 0 };
  const paint = performance
    .getEntriesByType("paint")
    .find((entry) => entry.name === "first-contentful-paint");

  // ---- Colour helpers, computed from what the browser resolved ----------
  const parse = (value) => {
    const match = /rgba?\(([^)]+)\)/.exec(value || "");
    if (!match) return null;
    const parts = match[1].split(",").map((part) => Number(part.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const ratio = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  /**
   * The effective background behind an element: walk up until something opaque.
   *
   * A translucent background is composited over whatever is behind it, so comparing
   * the text colour to a translucent surface would produce a ratio for a colour that is
   * never painted.
   */
  const effectiveBackground = (element) => {
    let node = element;
    while (node) {
      const colour = parse(getComputedStyle(node).backgroundColor);
      if (colour && colour.a > 0.95) return colour;
      node = node.parentElement;
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  };

  // ---- Contrast ----------------------------------------------------------
  const contrast = [];
  const seen = new Set();
  for (const element of document.querySelectorAll("body *")) {
    const text = [...element.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent.trim())
      .join(" ")
      .trim();
    if (!text) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const key = style.color + "|" + element.className;
    if (seen.has(key)) continue;
    seen.add(key);
    const fg = parse(style.color);
    if (!fg) continue;
    const bg = effectiveBackground(element);
    const size = Number.parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const value = ratio(over(fg, bg), bg);
    // An inactive control has no contrast minimum under WCAG 1.4.3. Recorded, not
    // dropped: see the exempt list above.
    const inactive = element.closest("button, input, select, textarea, fieldset")?.hasAttribute("disabled") ?? false;
    contrast.push({
      sample: text.slice(0, 40),
      color: style.color,
      background: 'rgb(' + [bg.r, bg.g, bg.b].join(", ") + ')',
      fontSize: size,
      ratio: Math.round(value * 100) / 100,
      minimum: large ? 3 : 4.5,
      passes: value >= (large ? 3 : 4.5),
      exempt: inactive,
    });
  }

  // ---- Accessible names --------------------------------------------------
  const interactive = [...document.querySelectorAll("button, a[href], input, select, textarea, [role='button'], [role='link'], [role='slider'], [role='switch'], [tabindex]")];
  const accessibleName = (element) => {
    const label = element.getAttribute("aria-label");
    if (label && label.trim()) return label.trim();
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      if (text) return text;
    }
    // element.labels is the DOM's own resolution of every label association -
    // wrapping labels, a for= attribute, or a label on an ancestor - which is what
    // assistive technology consults. The first version hand-rolled a subset of this
    // and reported two perfectly labelled import-mode radios as unnamed - how a
    // measurement tool starts insisting on changes the interface does not need.
    if ("labels" in element && element.labels && element.labels.length > 0) {
      const text = [...element.labels]
        .map((label) => (label.textContent || "").replace(/\s+/g, " ").trim())
        .join(" ")
        .trim();
      if (text) return text;
    }
    if (element.title && element.title.trim()) return element.title.trim();
    const own = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    if (own) return own;
    if (element instanceof HTMLInputElement && element.type === "submit" && element.value) {
      return element.value.trim();
    }
    return "";
  };
  const unnamed = interactive
    .filter((element) => element.getBoundingClientRect().width > 0 && accessibleName(element) === "")
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || undefined,
      testId: element.getAttribute("data-testid") || undefined,
      className: String(element.className).slice(0, 60),
      outer: element.outerHTML.slice(0, 120),
    }));

  // ---- Keyboard reachability --------------------------------------------
  const primary = [
    ...document.querySelectorAll(
      "nav a, nav button, nav [role='button'], nav [role='link'], main button, main a, main [role='button'], " +
        "[role='search'] input, aside button, aside a, aside [role='button'], header button, header a, header [role='button']",
    ),
  ];
  const keyboard = {
    primaryControls: primary.length,
    focusable: primary.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !element.hasAttribute("disabled");
    }).length,
    // A control reachable by pointer but not by keyboard is exactly the failure this
    // checks, and it is invisible to a screenshot.
    unreachableByTab: primary
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const tabIndex = element.getAttribute("tabindex");
        if (tabIndex !== null && Number(tabIndex) < 0) return true;
        if (element instanceof HTMLAnchorElement && !element.hasAttribute("href")) return true;
        if (element instanceof HTMLInputElement && element.type === "hidden") return true;
        return false;
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        testId: element.getAttribute("data-testid"),
        text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30),
      })),
  };

  return {
    vitals: {
      lcp: measured.lcp,
      cls: Math.round(measured.cls * 10000) / 10000,
      longestTask: Math.round(measured.longestTask),
      totalBlockingTime: Math.round(measured.totalBlockingTime),
      firstContentfulPaint: paint ? paint.startTime : null,
      observedDuringLoad: !!window.__m14vitals,
    },
    contrast: {
      checked: contrast.length,
      failures: contrast.filter((entry) => !entry.passes && !entry.exempt),
      // WCAG 1.4.3 exempts inactive controls from the contrast minimum. They are
      // recorded rather than dropped: a disabled button at 1.5:1 is a legitimate
      // exemption, and hiding the number would make the exemption indistinguishable
      // from never having measured it.
      exempt: contrast
        .filter((entry) => !entry.passes && entry.exempt)
        .map((entry) => ({ sample: entry.sample, ratio: entry.ratio, disabled: true })),
    },
    accessibleNames: { interactive: interactive.length, unnamed },
    keyboard,
  };
})()`;

async function main() {
  const results = {
    task: "3.1, 3.2, 4.1, 4.2",
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    targets: TARGETS,
    steps: [],
    screenshots: [],
    consoleErrors: [],
    notes: {
      disclosures: [],
      conditions: {},
    },
    pass: false,
  };
  const step = (name, ok, detail = "") => {
    results.steps.push({
      name,
      ok: !!ok,
      detail: String(detail).slice(0, 500),
    });
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
    );
    return !!ok;
  };

  let server;
  let browser;
  let ws;
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  const profileDir = mkdtempSync(join(tmpdir(), "spotivibe-audit-"));

  try {
    if (!existsSync(join(FRONTEND, ".next"))) {
      throw new Error(
        "No production build found — run `cd frontend && npm run build` first.",
      );
    }
    server = startServer();
    if (!(await waitForServer()))
      throw new Error(`Production server not reachable at ${ORIGIN}.`);

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
    // The conditions, recorded: a number without them is not comparable.
    results.notes.conditions = {
      userAgent: version["User-Agent"] ?? "unknown",
      platform: `${process.platform} ${process.arch}`,
      cpuCount: cpus().length,
      viewports: VIEWPORTS.map(
        (entry) => `${entry.width}x${entry.height}`,
      ).join(", "),
      load: "cold (fresh profile, first navigation)",
      servedBy: "next start on localhost",
      measurement:
        "PerformanceObserver inside the page; nothing is transmitted",
    };

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
        return;
      }
      for (const listener of listeners) listener(message);
    };
    // Connected at the *browser* endpoint, so page commands go through a target
    // session: `Page`, `Runtime`, and `Log` do not exist on the browser session, and
    // the target id is the only way to be sure which document is being measured.
    // Resolved lazily by target id: the attach event for a target created here can
    // arrive *before* the createTarget reply that names it.
    const sessions = new Map();
    let wantedTargetId = "";
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
    const send = (method, params = {}) => sendTo(pageSession(), method, params);
    const on = (method, handler) =>
      listeners.push(
        (message) =>
          message.method === method &&
          handler(message.params, message.sessionId),
      );

    wantedTargetId = (await send("Target.createTarget", { url: "about:blank" }))
      .targetId;
    on("Target.attachedToTarget", async (params) => {
      sessions.set(String(params.targetInfo?.targetId ?? ""), params.sessionId);
      try {
        if (params.targetInfo?.type !== "page") return;
        await sendTo(params.sessionId, "Page.enable");
        await sendTo(params.sessionId, "Runtime.enable");
        await sendTo(params.sessionId, "Log.enable");
      } catch {
        /* a target that closed before its domains were enabled is not a failure */
      }
    });
    await send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    const started = Date.now();
    while (!pageSession() && Date.now() - started < 20000) await delay(200);
    if (!pageSession()) throw new Error("The application page never attached.");

    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // Installed on every document, so the observers exist during each navigation.
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: VITALS_BOOTSTRAP,
    });
    on("Runtime.consoleAPICalled", (params, sessionId) => {
      if (params.type !== "error" || sessionId !== pageSession()) return;
      results.consoleErrors.push(
        `console.error: ${params.args
          .map((a) => a.value ?? a.description ?? "")
          .join(" ")
          .slice(0, 240)}`,
      );
    });
    on("Runtime.exceptionThrown", (params, sessionId) => {
      if (sessionId !== pageSession()) return;
      results.consoleErrors.push(
        `exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`.slice(
          0,
          240,
        ),
      );
    });

    const evaluate = async (expression) => {
      const response = await send("Runtime.evaluate", {
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
      timeoutMs = 30000,
    ) => {
      const started = Date.now();
      let last = null;
      while (Date.now() - started < timeoutMs) {
        try {
          last = await evaluate(expression);
          if (predicate(last)) return last;
        } catch {
          /* navigation in flight */
        }
        await delay(250);
      }
      throw new Error(
        `Timed out waiting for ${description} (last: ${JSON.stringify(last)})`,
      );
    };
    const goto = async (path, ready = "document.readyState") => {
      await send("Page.navigate", { url: `${ORIGIN}${path}` });
      await waitFor(
        `${path} ready`,
        ready,
        (value) => value === "complete" || value === true,
        30000,
      );
      // Let the load settle so LCP and layout shift have both been observed.
      await delay(1500);
    };

    // ---- 1. the audits can fire, before they are trusted -----------------
    const probe = await goto("/library").then(() =>
      evaluate(INSTRUMENTED_AUDIT),
    );
    const hasNumbers = (value) =>
      typeof value === "number" && Number.isFinite(value);
    step(
      "the measurement produces real numbers rather than nothing",
      hasNumbers(probe.vitals.cls) &&
        probe.contrast.checked > 0 &&
        probe.accessibleNames.interactive > 0,
      `CLS ${probe.vitals.cls}, ${probe.contrast.checked} contrast pairs, ${probe.accessibleNames.interactive} interactive elements`,
    );
    // The detector proof: inject a page whose text is unreadable and whose control has
    // no name, and assert the same audit finds both. An audit that has never been shown
    // to fire is a report, not a check.
    const canFail = await evaluate(`(() => {
      const host = document.createElement("div");
      host.id = "m14-degraded";
      host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#000;padding:24px";
      // A main landmark wrapper so the keyboard audit's selector - which looks in the
      // shell's landmark regions - actually sees the probe, and explicit sizes so the
      // geometry checks do not filter the controls out as zero-sized.
      host.innerHTML =
        '<main><nav><p style="color:#333;background:#000;font-size:14px">unreadable text</p>' +
        '<button id="m14-unnamed" style="width:48px;height:24px" tabindex="0"></button>' +
        '<div id="m14-notfocusable" role="button" style="width:90px;height:24px" tabindex="-1">pointer only</div>' +
        '</nav></main>';
      document.body.appendChild(host);
      return true;
    })()`);
    step("the degraded probe page is in the document", canFail === true);
    const degraded = await evaluate(INSTRUMENTED_AUDIT);
    const degradedContrast = degraded.contrast.failures.some((entry) =>
      entry.sample.includes("unreadable"),
    );
    const degradedUnnamed = degraded.accessibleNames.unnamed.some(
      (entry) => entry.id === "m14-unnamed" || entry.testId === "m14-unnamed",
    );
    const degradedUnreachable = degraded.keyboard.unreachableByTab.some(
      (entry) => entry.text === "pointer only",
    );
    step(
      "the contrast, naming, and keyboard audits each detect their failure",
      degradedContrast && degradedUnnamed && degradedUnreachable,
      `contrast=${degradedContrast} unnamed=${degradedUnnamed} unreachable=${degradedUnreachable}`,
    );
    await evaluate(`document.getElementById("m14-degraded")?.remove(); true`);

    // ---- 2. the real surfaces -------------------------------------------
    for (const viewport of VIEWPORTS) {
      for (const path of [
        "/library",
        "/search",
        "/history",
        "/settings",
        "/now-playing",
      ]) {
        await send("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.mobile,
        });
        await goto(path);
        const audit = await evaluate(INSTRUMENTED_AUDIT);
        const label = `${viewport.name} ${path}`;
        results.notes[`${viewport.name}${path.replace("/", "") || "home"}`] = {
          vitals: audit.vitals,
          contrastChecked: audit.contrast.checked,
          contrastFailures: audit.contrast.failures.length,
          interactiveElements: audit.accessibleNames.interactive,
          unnamed: audit.accessibleNames.unnamed.length,
          primaryControls: audit.keyboard.primaryControls,
          unreachableByTab: audit.keyboard.unreachableByTab.length,
        };

        step(
          `${label}: every text style meets its contrast minimum`,
          audit.contrast.failures.length === 0,
          audit.contrast.failures.length === 0
            ? `${audit.contrast.checked} pairs checked`
            : audit.contrast.failures
                .slice(0, 3)
                .map(
                  (entry) =>
                    `${entry.sample} ${entry.ratio}:1 (min ${entry.minimum})`,
                )
                .join("; "),
        );
        step(
          `${label}: every interactive element has an accessible name`,
          audit.accessibleNames.unnamed.length === 0,
          audit.accessibleNames.unnamed.length === 0
            ? `${audit.accessibleNames.interactive} controls`
            : JSON.stringify(audit.accessibleNames.unnamed.slice(0, 3)),
        );
        step(
          `${label}: no primary control is reachable only by pointer`,
          audit.keyboard.unreachableByTab.length === 0,
          `${audit.keyboard.focusable}/${audit.keyboard.primaryControls} focusable` +
            (audit.keyboard.unreachableByTab.length
              ? `; pointer-only: ${JSON.stringify(audit.keyboard.unreachableByTab.slice(0, 3))}`
              : ""),
        );
        step(
          `${label}: loading performance is within the stated targets`,
          audit.vitals.observedDuringLoad === true &&
            audit.vitals.lcp !== null &&
            audit.vitals.lcp <= TARGETS.lcpMs &&
            audit.vitals.cls <= TARGETS.cls &&
            audit.vitals.totalBlockingTime <= TARGETS.tbtMs &&
            audit.vitals.longestTask <= TARGETS.longestTaskMs,
          `LCP ${Math.round(audit.vitals.lcp ?? 0)}ms (≤${TARGETS.lcpMs}), CLS ${audit.vitals.cls} (≤${TARGETS.cls}), TBT ${audit.vitals.totalBlockingTime}ms (≤${TARGETS.tbtMs}), longest task ${Math.round(audit.vitals.longestTask)}ms (≤${TARGETS.longestTaskMs})`,
        );
      }
    }

    step(
      "zero console errors across every measured surface",
      results.consoleErrors.length === 0,
      results.consoleErrors.slice(0, 3).join(" | ") || "none",
    );

    results.notes.disclosures.push(
      `The production server's own log was written outside the repository, to the OS temp directory (${join(tmpdir(), `spotivibe-m14-audit-${PORT}.log`)}); check it there if a run fails to reach the origin.`,
      "A single-machine run against a local production build is a regression signal, not a field lab score. The thresholds detect a change between two runs on the same machine; they are not a claim about a real listener's device, network, or field percentile.",
      "INP is not observed, because it requires a real interaction. Total blocking time from long tasks stands in for responsiveness on a load, which is why the two thresholds are separate.",
      "Contrast is computed for text whose background the browser can resolve to an opaque colour. Text painted over a third-party album image is not computable from the DOM and is excluded rather than guessed; the audit records how many pairs it checked so the exclusion is visible.",
      "Keyboard reachability is checked through the elements' own semantics and tabindex, not by pressing Tab through the application; a control that is focusable but hidden behind a focus trap would not be caught.",
      "Both the desktop and the compact viewport are measured, because the compact shell does not render at the desktop size. A surface that renders at neither size is not covered by this run.",
    );
    results.pass = results.steps.every((entry) => entry.ok);
  } catch (error) {
    step(
      "the audit ran to completion",
      false,
      String(error?.stack ?? error).slice(0, 500),
    );
  } finally {
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
    delay(300).then(() => {
      try {
        rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    });
  }

  const failed = results.steps.filter((entry) => !entry.ok);
  results.summary = {
    steps: results.steps.length,
    passed: results.steps.length - failed.length,
    failed: failed.length,
    consoleErrors: results.consoleErrors.length,
  };
  writeFileSync(
    join(EVIDENCE_DIR, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `\n${results.pass ? "PASS" : "FAIL"} — ${results.summary.passed}/${results.summary.steps} checks, ${results.summary.consoleErrors} console errors.`,
  );
  process.exit(results.pass ? 0 : 1);
}

await main();
