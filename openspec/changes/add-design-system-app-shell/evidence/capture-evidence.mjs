/**
 * M1 visual-audit evidence capture (task 6.2).
 *
 * Drives a headless Edge over CDP (no npm dependencies, Node >= 22 built-in
 * WebSocket/fetch) against a running dev server and records:
 *   - rendered screenshots at exactly 390px, 820px, and 1280px viewports
 *     (Emulation.setDeviceMetricsOverride, deviceScaleFactor 2)
 *   - per-viewport shell variant visibility (mutual exclusion checks)
 *   - persistent-player proof across client-side route navigation
 *     (DOM marker survives Next.js Link navigation => no remount)
 *   - the scroll contract (main scrolls, shell regions stay fixed)
 *   - full keyboard focus traversal (real Tab key input, every stop outlined)
 *   - hover state changes (real mouse input)
 *   - disabled transport controls, empty-state copy, accessible names
 *     (Accessibility.getFullAXTree), branding scan, console/page errors
 *
 * Usage: node capture-evidence.mjs [baseUrl] [outDir]
 *   e.g. node capture-evidence.mjs http://localhost:3001 .
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const BASE = process.argv[2] ?? "http://localhost:3001";
const OUT = path.resolve(process.argv[3] ?? ".");
const PORT = 9333;
const PROFILE = path.join(process.env.TEMP ?? ".", "spotivibe-m1-cdp-profile");

const EDGE = EDGE_CANDIDATES.find((p) => {
  try {
    return process.getBuiltinModule("node:fs").existsSync(p);
  } catch {
    return false;
  }
});
if (!EDGE) throw new Error("No Edge/Chrome executable found");

mkdirSync(OUT, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });

const browser = spawn(
  EDGE,
  [
    "--headless",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const report = { base: BASE, capturedAt: new Date().toISOString(), shots: [], variants: [], checks: {} };

function fail(msg) {
  browser.kill();
  throw new Error(msg);
}

// --- CDP plumbing ---------------------------------------------------------
let ws;
let msgId = 0;
let loadCount = 0;
const pending = new Map();
const events = { errors: [], console: [] };

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("evaluate failed: " + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function waitFor(expression, label, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await evalJs(expression)) return true;
    } catch {
      /* page may be mid-navigation */
    }
    await sleep(200);
  }
  fail(`timeout waiting for ${label} (${expression})`);
}

const READY =
  "document.readyState === 'complete' && !!document.querySelector('[data-testid=\"player-bar\"]') && document.fonts.status === 'loaded'";

async function connect() {
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch {
      await sleep(200);
    }
  }
  if (!target) fail("no CDP page target");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("ws error"));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method === "Page.loadEventFired") {
      loadCount += 1;
    } else if (m.method === "Runtime.exceptionThrown") {
      events.errors.push(m.params.exceptionDetails.text);
    } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      events.console.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      events.console.push(m.params.entry.text);
    }
  };
}

const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(OUT, name), Buffer.from(data, "base64"));
  report.shots.push(name);
};

const variantExpr = `JSON.stringify({
  w: window.innerWidth, h: window.innerHeight,
  header: !!document.querySelector("header"),
  sidebar: (() => { const el = document.querySelector("aside"); return el ? getComputedStyle(el).display : "missing"; })(),
  playerBar: (() => { const el = document.querySelector('[data-testid="player-bar"]'); return el ? getComputedStyle(el).display : "missing"; })(),
  compactShell: (() => { const el = document.querySelector('[data-testid="compact-shell"]'); return el ? getComputedStyle(el).display : "missing"; })(),
  bottomNav: (() => { const el = document.querySelector('nav[aria-label="Primary"]'); return el ? getComputedStyle(el).display : "missing"; })(),
  miniPlayer: (() => { const el = document.querySelector('[data-testid="mini-player"]'); return el ? getComputedStyle(el).display : "missing"; })()
})`;

async function setViewport(width, height, mobile) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 2,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
}

async function waitForLoad(before, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (loadCount > before) return;
    await sleep(100);
  }
  fail("timed out waiting for a document load event");
}

async function go(url) {
  // Gate on a fresh load event so same-URL navigations cannot match a stale
  // document that is already "ready".
  const before = loadCount;
  await send("Page.navigate", { url });
  await waitForLoad(before);
  await waitFor(READY, "ready at " + url);
  await sleep(500);
}

async function main() {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  report.browser = (await send("Browser.getVersion")).product;

  const VIEWS = [
    { w: 390, h: 844, mobile: true, routes: ["/", "/search", "/library", "/now-playing"] },
    { w: 820, h: 1000, mobile: false, routes: ["/"] },
    { w: 1280, h: 800, mobile: false, routes: ["/"] },
  ];
  const routeSlug = (r) => (r === "/" ? "home" : r.slice(1).replace(/\//g, "-"));

  // 1. Rendered screenshots + shell-variant visibility per viewport/route.
  for (const v of VIEWS) {
    await setViewport(v.w, v.h, v.mobile);
    for (const route of v.routes) {
      await go(BASE + route);
      const variant = JSON.parse(await evalJs(variantExpr));
      report.variants.push({ viewport: `${v.w}x${v.h}`, route, ...variant });
      await shot(`${routeSlug(route)}-${v.w}.png`);
      if (route === "/") {
        report.checks[`empty_${v.w}`] = await evalJs(
          `JSON.stringify((document.querySelector("main")?.innerText || "").split("\\n").map(s => s.trim()).filter(Boolean))`,
        );
      }
    }
  }

  // 2. Persistent player across client-side navigation (DOM marker survives
  //    Next.js Link navigation => the player element was never remounted).
  const navChecks = [
    { w: 390, h: 844, mobile: true, link: 'nav[aria-label="Primary"] a[href="/search"]', to: "/search" },
    { w: 1280, h: 800, mobile: false, link: 'aside a[href="/search"]', to: "/search" },
  ];
  report.checks.playerPersistence = [];
  for (const c of navChecks) {
    await setViewport(c.w, c.h, c.mobile);
    await go(BASE + "/");
    await evalJs(
      `document.querySelector('[data-testid="player-bar"]').dataset.m1audit = "preserved"; ` +
        `document.querySelector('[data-testid="mini-player"]').dataset.m1audit = "preserved";`,
    );
    await evalJs(`document.querySelector(${JSON.stringify(c.link)}).click()`);
    await waitFor(`location.pathname === ${JSON.stringify(c.to)} && ${READY}`, "client nav to " + c.to);
    await sleep(600);
    report.checks.playerPersistence.push({
      viewport: `${c.w}x${c.h}`,
      link: c.link,
      landed: await evalJs("location.pathname"),
      playerBarMarker: await evalJs(
        `document.querySelector('[data-testid="player-bar"]')?.dataset.m1audit ?? null`,
      ),
      miniPlayerMarker: await evalJs(
        `document.querySelector('[data-testid="mini-player"]')?.dataset.m1audit ?? null`,
      ),
      playerRegionVisible: await evalJs(`(() => {
        for (const sel of ['[data-testid="player-bar"]', '[data-testid="mini-player"]']) {
          const el = document.querySelector(sel);
          if (el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0) return sel;
        }
        return null;
      })()`),
    });
  }

  // 3. Keyboard focus traversal (real Tab input) at 1280 on /now-playing, so
  //    the stops cover top bar → sidebar → main content → player region.
  await setViewport(1280, 800, false);
  await go(BASE + "/now-playing");
  const focusTrail = [];
  for (let i = 0; i < 10; i++) {
    await send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    await sleep(120);
    const info = JSON.parse(
      await evalJs(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return JSON.stringify({ tag: "BODY" });
        const s = getComputedStyle(el);
        return JSON.stringify({
          tag: el.tagName,
          name: el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 40),
          href: el.getAttribute("href"),
          outline: s.outlineStyle + " " + s.outlineWidth + " " + s.outlineColor,
          outlineOffset: s.outlineOffset
        });
      })()`),
    );
    if (info.tag === "BODY") break;
    focusTrail.push({ stop: i + 1, ...info });
    if (i === 0) await shot("focus-visible-1280.png");
  }
  report.checks.focusTrail = focusTrail;
  await shot("focus-traversal-1280.png");

  // 4. Hover state changes (real mouse input) at each shell variant. Disabled
  //    controls use `disabled:pointer-events-none`, so the disabled play
  //    button is expected to show NO hover response — recorded as such.
  const hoverTargets = [
    { name: "topbar-nav-arrow", sel: "header button", w: 1280, h: 800, mobile: false, shot: "hover-navarrow-1280.png" },
    { name: "sidebar-pill-cta", sel: 'aside a[href="/library"]', w: 1280, h: 800, mobile: false },
    { name: "sidebar-prompt-card", sel: "aside .rounded-cards", w: 1280, h: 800, mobile: false, shot: "hover-card-1280.png" },
    { name: "player-play-disabled", sel: '[data-testid="player-bar"] button[aria-label="Play"]', w: 1280, h: 800, mobile: false },
    { name: "bottomnav-link", sel: 'nav[aria-label="Primary"] a[href="/search"]', w: 390, h: 844, mobile: true, shot: "hover-bottomnav-390.png" },
  ];
  report.checks.hover = [];
  for (const t of hoverTargets) {
    await setViewport(t.w, t.h, t.mobile);
    await go(BASE + "/");
    const box = JSON.parse(
      await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(t.sel)});
        if (!el) return "null"; const r = el.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); })()`),
    );
    if (box === "null") {
      report.checks.hover.push({ target: t.name, error: "element not found" });
      continue;
    }
    const styleOf = () =>
      evalJs(
        `(() => { const el = document.querySelector(${JSON.stringify(t.sel)}); const s = getComputedStyle(el);
          return JSON.stringify({ bg: s.backgroundColor, color: s.color, scale: s.scale, transform: s.transform, translate: s.translate }); })()`,
      );
    const before = JSON.parse(await styleOf());
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    await sleep(350);
    const after = JSON.parse(await styleOf());
    report.checks.hover.push({
      target: t.name,
      selector: t.sel,
      viewport: `${t.w}x${t.h}`,
      before,
      after,
      changed: JSON.stringify(before) !== JSON.stringify(after),
    });
    if (t.shot) await shot(t.shot);
  }

  // 4b. Scroll contract (spec R2 scenario): main scrolls while the shell
  //     regions stay fixed — checked at 1280px (scenario width) and 390px.
  report.checks.scroll = [];
  for (const v of [
    { w: 1280, h: 800, mobile: false },
    { w: 390, h: 844, mobile: true },
  ]) {
    await setViewport(v.w, v.h, v.mobile);
    await go(BASE + "/");
    const r = JSON.parse(
      await evalJs(`(() => {
        const visTop = (sels) => {
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el && getComputedStyle(el).display !== "none") return Math.round(el.getBoundingClientRect().top);
          }
          return null;
        };
        const regionTops = () => ({
          header: visTop(["header"]),
          player: visTop(['[data-testid="player-bar"]', '[data-testid="mini-player"]']),
          nav: visTop(['nav[aria-label="Primary"]'])
        });
        const main = document.querySelector("main");
        const canScroll = main.scrollHeight > main.clientHeight;
        const before = regionTops();
        main.scrollTop = 160;
        const scrolledTo = main.scrollTop;
        const after = regionTops();
        main.scrollTop = 0;
        return JSON.stringify({
          canScroll,
          scrolledTo,
          regionsBefore: before,
          regionsAfter: after,
          shellFixed: JSON.stringify(before) === JSON.stringify(after)
        });
      })()`),
    );
    report.checks.scroll.push({ viewport: `${v.w}x${v.h}`, ...r });
  }

  // 5. Disabled transport controls + accessible names + branding at desktop.
  await setViewport(1280, 800, false);
  await go(BASE + "/");
  report.checks.disabledControls = JSON.parse(
    await evalJs(`JSON.stringify([...document.querySelectorAll('[data-testid="player-bar"] button')].map(b => {
      const s = getComputedStyle(b);
      return { label: b.getAttribute("aria-label"), disabled: b.disabled, cursor: s.cursor, opacity: s.opacity, color: s.color, bg: s.backgroundColor };
    }))`),
  );

  // 6. Accessible names via the browser's AX tree for interactive roles.
  const ax = await send("Accessibility.getFullAXTree");
  const ROLES = ["button", "link", "textbox", "searchbox", "navigation", "search", "banner", "main", "combobox", "slider", "progressbar"];
  const interactive = ax.nodes.filter(
    (n) => ROLES.includes(n.role?.value) && (!n.properties || !n.properties.some((p) => p.name === "disabled" && p.value.value === true)),
  );
  report.checks.accessibleNames = {
    inspected: interactive.length,
    missing: interactive.filter((n) => !n.name?.value).map((n) => n.role?.value),
    named: interactive.map((n) => ({ role: n.role?.value, name: n.name?.value })),
  };

  // 7. Branding scan + console/page errors.
  report.checks.branding = JSON.parse(
    await evalJs(`JSON.stringify({
      title: document.title,
      textMatches: (document.body.innerText.match(/spotify/gi) || []),
      imageSrcs: [...document.images].map(i => i.currentSrc || i.src),
      spotifyLinks: [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => /spotify\\.com/i.test(h))
    })`),
  );
  report.checks.errors = { exceptions: events.errors, consoleErrors: events.console };

  writeFileSync(path.join(OUT, "audit-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ shots: report.shots.length, out: OUT, errors: report.checks.errors }, null, 2));
  browser.kill();
}

main().catch((err) => {
  console.error(String(err.stack || err));
  browser.kill();
  process.exit(1);
});
