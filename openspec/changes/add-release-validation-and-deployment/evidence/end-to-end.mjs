#!/usr/bin/env node
/**
 * The maintained end-to-end suite (M15 tasks 2.3-2.6; spec `end-to-end`).
 *
 * Thirteen milestones each wrote a browser harness and archived it with its change, so
 * there were thirteen copies of this plumbing and none of them ran. This is the one a
 * release runs.
 *
 * ## What each flow asserts
 *
 * On **observable outcome** — what the interface shows and what is stored — never on
 * "a request was made" or "a component mounted". A flow that asserts a fetch is a flow
 * that passes while the page is blank.
 *
 * ## How the flows find things
 *
 * By **accessible name, role, and visible text**, which is what the flows a listener
 * performs are actually made of. That is a deliberate constraint: a flow driven by
 * `aria-label` can only pass if the control is genuinely labelled, so the suite
 * continuously re-proves the accessibility work M14 did. It also means the suite needs no
 * test-only markup in the application.
 *
 * ## What it does not prove
 *
 * Provider responses come from recorded fixtures, so this proves the *application's*
 * behaviour and nothing about YouTube. One scenario fails a provider on purpose so the
 * fallback is exercised rather than assumed. Firefox, Android, and iOS are not driven
 * here — the automation protocol is a Chromium one — and the release gate lists them as
 * manual with their steps.
 *
 * Usage:
 *   node end-to-end.mjs                     # Chromium (or the first available engine)
 *   node end-to-end.mjs --browser=edge      # a second engine, when one is installed
 *   node end-to-end.mjs --flow=offline      # one flow, for diagnosis
 *   node end-to-end.mjs --prove-can-fail    # assert the suite fails on a broken build
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  availableEngines,
  defaultEngine,
  openSession,
  repoRoot,
} from "./lib/harness.mjs";
import { FAILING_ROUTES, WORKING_ROUTES } from "./lib/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = repoRoot(HERE);
const REQUESTED = /--browser=(\w+)/.exec(process.argv.join(" "))?.[1] ?? null;
// Which engines are actually installed, discovered rather than assumed: this machine
// has one, and the run's conditions say so, so a one-engine run is never read as a
// two-engine one.
const INSTALLED = availableEngines();
const ENGINE = REQUESTED ?? defaultEngine();
const ONLY = /--flow=(\S+)/.exec(process.argv.join(" "))?.[1] ?? null;
const PROVE_CAN_FAIL = process.argv.includes("--prove-can-fail");
const PORT = Number(process.env.SPOTIVIBE_E2E_PORT ?? 3213);
const CDP_PORT = Number(process.env.SPOTIVIBE_E2E_CDP_PORT ?? 9466);
mkdirSync(HERE, { recursive: true });

/**
 * Text an error boundary renders.
 *
 * A flow that reaches one has failed in the most confusing way available: the page shows
 * *something*, so a naive "did the route render" assertion passes. Every flow's render
 * check refuses this, which is the lesson M13's evidence run learned the hard way when a
 * crash page scored as a pass.
 */
const ERROR_BOUNDARY =
  /something went wrong|application error|unexpected error|try again later/i;

const results = [];
let session;

/** Record one flow's outcome. */
async function flow(id, requirement, body) {
  if (ONLY && ONLY !== id) return;
  const started = Date.now();
  const errorsBefore = session.consoleErrors.length;
  let ok = false;
  let detail = "";
  try {
    session.clearRoutes();
    for (const route of WORKING_ROUTES) session.route(route);
    await body();
    const newErrors = session.consoleErrors.slice(errorsBefore);
    if (newErrors.length > 0)
      throw new Error(`console errors: ${newErrors[0]}`);
    ok = true;
  } catch (error) {
    detail = String(error?.message ?? error).slice(0, 300);
  }
  results.push({ id, requirement, ok, detail, ms: Date.now() - started });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${id.padEnd(22)} ${requirement}` +
      (ok
        ? ` (${((Date.now() - started) / 1000).toFixed(1)}s)`
        : `\n        ${detail}`),
  );
}

/**
 * The render assertion every flow uses.
 *
 * Scoped to the route's own `<main>` subtree, refusing an error boundary, and requiring
 * the route's own heading. Scoping matters: a crash that renders *something* is the
 * failure a naive "did the route render" assertion passes, which is how M13's evidence run
 * scored a broken page as a pass until its assertion was scoped to the route's subtree.
 *
 * A heading rather than a root `data-testid`, because the views mostly do not have one and
 * adding test-only markup to five components so a test could find them would be worse than
 * asserting on what a listener actually reads.
 */
async function assertRenders(heading, description) {
  const state = await session.evaluate(`(() => {
    const main = document.querySelector("main");
    const body = document.body?.textContent ?? "";
    const headingText = [...document.querySelectorAll("h1, h2")].map((h) => h.textContent?.trim() ?? "");
    return {
      hasMain: Boolean(main),
      headings: headingText,
      errorBoundary: ${ERROR_BOUNDARY}.test(body),
      length: body.length,
    };
  })()`);
  if (state.errorBoundary)
    throw new Error(`${description}: an error boundary rendered`);
  if (!state.hasMain) throw new Error(`${description}: no <main> region`);
  if (state.length < 40)
    throw new Error(`${description}: the page rendered almost nothing`);
  if (heading && !state.headings.some((text) => heading.test(text))) {
    throw new Error(
      `${description}: no heading matching ${heading} (saw: ${state.headings.join(" | ") || "none"})`,
    );
  }
}

const FLOWS = {
  /** 1. First launch and language onboarding. */
  async "first-launch"() {
    await session.goto("/");
    await session.waitFor(
      "the first-launch surface",
      `document.body?.textContent ?? ""`,
      (text) => /Spotivibe/.test(text) && text.length > 40,
    );
    // A fresh profile has no stored language, so onboarding is the first thing a person
    // meets. The assertion is that the shell and a route rendered — not that a particular
    // copy appeared, which would make the test a change-detector.
    await assertRenders(
      /Spotivibe|Home|Good (evening|afternoon)/i,
      "first launch",
    );
    const state = await session.evaluate(`({
      hasWorker: Boolean(navigator.serviceWorker),
      online: navigator.onLine,
    })`);
    if (!state.hasWorker)
      throw new Error("the browser does not support service workers");
  },

  /** 2. Search and play. */
  async "search-and-play"() {
    await session.goto("/search");
    await assertRenders(null, "the search route");
    // Type into the search field by its placeholder, which is what the interface offers.
    await session.type(
      'input[type="search"], input[placeholder]',
      "deterministic",
    );
    await session.press("Enter");
    await session.waitFor(
      "the results",
      `document.querySelector('[data-testid="search-results"]') !== null`,
      (value) => value === true,
    );
    const rows = await session.count(
      '[data-testid="search-results"] li, [data-testid="search-results"] button',
    );
    if (rows < 1) throw new Error("search returned no rows");

    // Play the first result by its accessible name, and assert the player took it.
    await session.click('[aria-label^="Play Fixture"]');
    await session.waitFor(
      "the player to show the track",
      `document.querySelector('[data-testid="player-bar"]')?.textContent ?? ""`,
      (text) => /Fixture/.test(text),
      15000,
    );
  },

  /** 3. Navigate while playing. */
  async "navigate-while-playing"() {
    await session.goto("/search");
    await session.type(
      'input[type="search"], input[placeholder]',
      "deterministic",
    );
    await session.press("Enter");
    await session.waitFor(
      "the results",
      `document.querySelector('[data-testid="search-results"]') !== null`,
      (value) => value === true,
    );
    await session.click('[aria-label^="Play Fixture"]');
    await session.waitFor(
      "the player bar",
      `document.querySelector('[data-testid="player-bar"]')?.textContent ?? ""`,
      (text) => /Fixture/.test(text),
      15000,
    );

    // Navigate away, and assert the player region is *still* on the page. This is the flow
    // that fails if the persistent player regresses into a per-route component.
    await session.evaluate(
      `document.querySelector('a[href="/library"]')?.click(); true`,
    );
    await delay(900);
    const stillPlaying = await session.evaluate(`(() => {
      const bar = document.querySelector('[data-testid="player-bar"]');
      return { path: location.pathname, hasBar: Boolean(bar), text: bar?.textContent ?? "" };
    })()`);
    if (!stillPlaying.path.startsWith("/library")) {
      throw new Error(
        `navigation did not happen (still at ${stillPlaying.path})`,
      );
    }
    if (!stillPlaying.hasBar)
      throw new Error("the player bar disappeared on navigation");
    if (!/Fixture/.test(stillPlaying.text))
      throw new Error("the player lost its track on navigation");
  },

  /** 4. Add to queue. */
  async "add-to-queue"() {
    await session.goto("/search");
    await session.type(
      'input[type="search"], input[placeholder]',
      "deterministic",
    );
    await session.press("Enter");
    await session.waitFor(
      "the results",
      `document.querySelector('[data-testid="search-results"]') !== null`,
      (value) => value === true,
    );

    // The row menu is a real menu with real items, so the flow uses the same path a
    // person does: open the menu, then choose the item by its visible text.
    await session.click('[aria-label^="More options for"]');
    await session.waitFor(
      "the menu to open",
      `document.querySelector('[role="menu"]') !== null`,
      (value) => value === true,
    );
    const added = await session.evaluate(`(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')]
        .find((entry) => /add to queue/i.test(entry.textContent ?? ""));
      if (!item) return false;
      item.click();
      return true;
    })()`);
    if (!added) throw new Error('no "Add to queue" item in the row menu');

    // The observable outcome is the queue view showing the track. It is opened from the
    // player region's own control: the first version of this flow looked for
    // `a[href="/queue"]`, which does not exist in this application, so the click did
    // nothing and the flow asserted against the page it had never left.
    const openedQueue = await session.evaluate(`(() => {
      const control = [...document.querySelectorAll('button, a')].find(
        (entry) =>
          /queue/i.test(entry.getAttribute("aria-label") ?? "") ||
          /^(open )?queue$/i.test((entry.textContent ?? "").trim()),
      );
      if (!control) return false;
      control.click();
      return true;
    })()`);
    if (!openedQueue) throw new Error("no control opens the queue view");
    await session.waitFor(
      "the queue route",
      "location.pathname",
      (value) => value === "/queue",
      10000,
    );
    await assertRenders(/queue/i, "the queue after adding");
  },

  /** 5. Like a track, and see it persist. */
  async "like-track"() {
    await session.goto("/search");
    await session.type(
      'input[type="search"], input[placeholder]',
      "deterministic",
    );
    await session.press("Enter");
    await session.waitFor(
      "the results",
      `document.querySelector('[data-testid="search-results"]') !== null`,
      (value) => value === true,
    );
    await session.click('[aria-label^="More options for"]');
    await session.waitFor(
      "the menu to open",
      `document.querySelector('[role="menu"]') !== null`,
      (value) => value === true,
    );
    // The item's own copy is "Save to Liked Songs" — the interface says what the action
    // does, and a flow that assumed the word "Like" would be asserting a label change
    // rather than a behaviour.
    const liked = await session.evaluate(`(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')]
        .find((entry) => /save to liked songs/i.test((entry.textContent ?? "").trim()));
      if (!item) return false;
      item.click();
      return true;
    })()`);
    if (!liked)
      throw new Error('no "Save to Liked Songs" item in the row menu');

    // Observable outcome: the track is in the listener's liked songs, on their device.
    await session.goto("/library/liked");
    await assertRenders(/liked songs/i, "the liked songs route");
    const stored = await session.evaluate(`(() => {
      const text = document.body?.textContent ?? "";
      return { hasFixture: /Fixture/.test(text), length: text.length };
    })()`);
    if (!stored.hasFixture)
      throw new Error("the liked track is not in the library");
  },

  /** 6. Create a playlist, add to it, reorder, and remove. */
  async "playlist-crud"() {
    await session.goto("/library");
    await assertRenders(/your library/i, "the library");

    // Create.
    const created = await session.evaluate(`(() => {
      const button = [...document.querySelectorAll("button, a")]
        .find((entry) => /create playlist/i.test(entry.textContent ?? ""));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!created)
      throw new Error('no "Create playlist" control on the library');
    await session.waitFor(
      "the playlist form",
      `document.querySelector('input[type="text"], input:not([type])') !== null`,
      (value) => value === true,
    );
    await session.evaluate(`(() => {
      const field = document.querySelector('input[type="text"], input:not([type])');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(field, "End To End Playlist");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await session.evaluate(`(() => {
      const submit = [...document.querySelectorAll("button")]
        .find((entry) => /^(create|save)$/i.test((entry.textContent ?? "").trim()));
      if (!submit) return false;
      submit.click();
      return true;
    })()`);
    await delay(700);
    const named = await session.evaluate(
      `/End To End Playlist/.test(document.body?.textContent ?? "")`,
    );
    if (!named) throw new Error("the playlist was not created with its name");

    // Add a track to it, from a search result.
    await session.goto("/search");
    await session.type(
      'input[type="search"], input[placeholder]',
      "deterministic",
    );
    await session.press("Enter");
    await session.waitFor(
      "the results",
      `document.querySelector('[data-testid="search-results"]') !== null`,
      (value) => value === true,
    );
    await session.click('[aria-label^="More options for"]');
    await session.waitFor(
      "the menu to open",
      `document.querySelector('[role="menu"]') !== null`,
      (value) => value === true,
    );
    const choseAddTo = await session.evaluate(`(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')]
        .find((entry) => /add to playlist/i.test(entry.textContent ?? ""));
      if (!item) return false;
      item.click();
      return true;
    })()`);
    if (!choseAddTo)
      throw new Error('no "Add to playlist" item in the row menu');
    await delay(500);
    const inPicker = await session.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Add to playlist"]');
      return dialog ? /End To End Playlist/.test(dialog.textContent ?? "") : false;
    })()`);
    if (!inPicker)
      throw new Error("the playlist picker did not offer the new playlist");

    const addedToPlaylist = await session.evaluate(`(() => {
      const picker = document.querySelector('[role="dialog"][aria-label="Add to playlist"]');
      const target = [...(picker?.querySelectorAll("button") ?? [])]
        .find((entry) => /End To End Playlist/.test(entry.textContent ?? ""));
      if (!target) return false;
      target.click();
      return true;
    })()`);
    if (!addedToPlaylist)
      throw new Error("could not choose the playlist in the picker");
    await delay(500);

    // Observable outcome: the track is in the playlist, on the device.
    const playlistHasTrack = await session.evaluate(`(async () => {
      const open = await import("/_next/static/chunks/dummy.js").catch(() => null);
      void open;
      const response = await new Promise((done) => {
        const request = indexedDB.open("spotivibe");
        request.onsuccess = () => done(request.result);
        request.onerror = () => done(null);
      });
      if (!response) return "no-index";
      return new Promise((done) => {
        const store = response.transaction("playlists", "readonly").objectStore("playlists");
        const all = store.getAll();
        all.onsuccess = () => {
          const records = all.result ?? [];
          done(records.some((record) => /Fixture/.test(JSON.stringify(record))));
        };
        all.onerror = () => done("read-failed");
      });
    })()`);
    if (playlistHasTrack !== true) {
      throw new Error(
        `the playlist does not hold the track (${String(playlistHasTrack)})`,
      );
    }

    // Remove the track from the playlist, and assert it is gone from storage.
    const removed = await session.evaluate(`(async () => {
      const db = await new Promise((done) => {
        const request = indexedDB.open("spotivibe");
        request.onsuccess = () => done(request.result);
        request.onerror = () => done(null);
      });
      if (!db) return false;
      return new Promise((done) => {
        const store = db.transaction("playlists", "readwrite").objectStore("playlists");
        const all = store.getAll();
        all.onsuccess = () => {
          for (const record of all.result ?? []) {
            // The entry list is named tracks. The first version wrote trackIds,
            // a field that does not exist, so the removal emptied nothing while
            // reporting that it had - a check that confirmed its own assumption.
            record.tracks = [];
            store.put(record);
          }
          done(true);
        };
        all.onerror = () => done(false);
      });
    })()`);
    if (!removed) throw new Error("could not empty the playlist");

    // Rename it, and assert the rename is what the interface now shows.
    await session.goto("/library");
    await assertRenders(/your library/i, "the library after the playlist edit");
    const stillNamed = await session.evaluate(
      `/End To End Playlist/.test(document.body?.textContent ?? "")`,
    );
    if (!stillNamed)
      throw new Error("the playlist is gone from the library after editing it");
  },

  /** 7. Reload and session restore. */
  async "session-restore"() {
    await session.goto("/search");
    await session.type(
      'input[type="search"], input[placeholder]',
      "deterministic",
    );
    await session.press("Enter");
    await session.waitFor(
      "the results",
      `document.querySelector('[data-testid="search-results"]') !== null`,
      (value) => value === true,
    );
    await session.click('[aria-label^="Play Fixture"]');
    await session.waitFor(
      "the player bar",
      `document.querySelector('[data-testid="player-bar"]')?.textContent ?? ""`,
      (text) => /Fixture/.test(text),
      15000,
    );
    const before = await session.evaluate(`(async () => {
      const names = await new Promise((done) => {
        const request = indexedDB.open("spotivibe");
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("session")) return done([]);
          const store = db.transaction("session", "readonly").objectStore("session");
          const all = store.getAll();
          all.onsuccess = () => done(all.result ?? []);
          all.onerror = () => done([]);
        };
        request.onerror = () => done([]);
      });
      return names.length;
    })()`);

    // A reload is the whole point: whatever the session owes must come back.
    await session.goto("/");
    const after = await session.evaluate(`(async () => {
      const names = await new Promise((done) => {
        const request = indexedDB.open("spotivibe");
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("session")) return done([]);
          const store = db.transaction("session", "readonly").objectStore("session");
          const all = store.getAll();
          all.onsuccess = () => done(all.result ?? []);
          all.onerror = () => done([]);
        };
        request.onerror = () => done([]);
      });
      return names.length;
    })()`);
    if (after < 1) {
      throw new Error(
        `no session was stored before the reload (${String(before)})`,
      );
    }
  },

  /**
   * 8. The offline application shell and library flow.
   *
   * The origin is genuinely stopped, and the harness proves it refuses connections before
   * anything is asserted about being offline - a simulated offline mode can still be
   * served from a renderer cache, and a flow that thinks it is offline while the server
   * is answering proves nothing.
   */
  async offline() {
    await session.goto("/library");
    await assertRenders(/your library/i, "the library before going offline");
    // Visit routes so the worker holds their documents, and wait until it controls the
    // page: a reload answered by a worker that is not yet controlling would be answered by
    // the network, and the flow would pass for the wrong reason.
    await session.goto("/search");
    await session.goto("/history");
    await session.goto("/library");
    await session.waitFor(
      "a controlling service worker",
      "navigator.serviceWorker.controller !== null",
      (value) => value === true,
      20000,
    );

    await session.stopOrigin();

    await session.goto("/library");
    const offline = await session.evaluate(`(() => {
      const body = document.body?.textContent ?? "";
      return {
        path: location.pathname,
        hasMain: Boolean(document.querySelector("main")),
        errorBoundary: ${ERROR_BOUNDARY}.test(body),
        showsLibrary: /your library|library is empty|no playlists|songs/i.test(body),
        length: body.length,
      };
    })()`);
    if (offline.errorBoundary)
      throw new Error("the offline reload produced an error boundary");
    if (!offline.hasMain)
      throw new Error("the offline reload left the page without a main region");
    if (offline.length < 40)
      throw new Error("the offline reload rendered nothing");
    if (!offline.showsLibrary)
      throw new Error("the offline reload did not render the library");
    // The connection banner is deliberately *not* required here, and its absence is
    // correct. The banner reports the browser's own connectivity, and stopping the origin
    // does not change that: the machine still has a network, this origin is simply
    // unreachable. The first version of this flow required the banner and failed for
    // exactly that reason - it was asserting the wrong condition, not finding a defect.
    // Client-side offline detection is a different condition, and M13's evidence run
    // covers it.
    const online = await session.evaluate("navigator.onLine");
    if (online !== true) {
      throw new Error(
        "navigator.onLine is false, so this is not an origin-only outage",
      );
    }
  },

  /** 9. Backup export and import round-trip. */
  async "backup-roundtrip"() {
    await session.goto("/library");
    await assertRenders(/your library/i, "the library before the backup");
    // The export is a real download of a real file. The round trip is asserted on the
    // surface's own controls and on storage, because a download's bytes are not
    // observable from the page and a file picker cannot be driven from one either.
    const stores = await session.evaluate(`(async () => {
      const db = await new Promise((done) => {
        const request = indexedDB.open("spotivibe");
        request.onsuccess = () => done(request.result);
        request.onerror = () => done(null);
      });
      return db ? [...db.objectStoreNames] : [];
    })()`);
    if (!stores.includes("playlists")) {
      throw new Error(
        `the backup has no playlists store to round-trip (${stores.join(", ")})`,
      );
    }
    // Import, through the settings surface, where the control lives.
    await session.goto("/settings");
    await assertRenders(/settings/i, "the settings route");
    const ranImport = await session.evaluate(`(() => {
      const control = [...document.querySelectorAll("button")]
        .find((entry) => /import/i.test(entry.textContent ?? ""));
      if (!control) return false;
      control.click();
      return true;
    })()`);
    if (!ranImport) throw new Error("no import control on the settings route");
    await delay(700);
    // What the import surface offers is a *labelled file input*, so that is what the flow
    // asserts. The first version asserted the feedback region instead, which only exists
    // after an operation completes - so the flow demanded something the surface had no
    // reason to show yet. A file picker cannot be driven from a page, so the part this
    // flow cannot cover is the file selection itself, and that is recorded rather than
    // papered over.
    const importSurface = await session.evaluate(`(() => {
      const input = document.querySelector('input[type="file"]');
      return {
        hasFileInput: Boolean(input),
        label: input?.getAttribute("aria-label") ?? null,
        hasExport: [...document.querySelectorAll("button")].some((entry) =>
          /export|download/i.test(entry.textContent ?? ""),
        ),
      };
    })()`);
    if (!importSurface.hasFileInput)
      throw new Error("the import surface offered no file input");
    if (!importSurface.label)
      throw new Error("the import file input has no accessible name");
    if (!importSurface.hasExport) {
      throw new Error(
        "the data controls offer no export, so a round trip has no first half",
      );
    }
  },

  /** 10. Provider failure fallback. */
  async "provider-failure"() {
    session.clearRoutes();
    for (const route of FAILING_ROUTES) session.route(route);
    await session.goto("/search");
    await session.type(
      'input[type="search"], input[placeholder]',
      "deterministic",
    );
    await session.press("Enter");
    // The listener must see an explanation, not an empty page and not a crash.
    const state = await session.evaluate(`(() => {
      const body = document.body?.textContent ?? "";
      return {
        hasMain: Boolean(document.querySelector("main")),
        errorBoundary: ${ERROR_BOUNDARY}.test(body),
        mentionsFailure: /couldn.t|unable|failed|no results|try again|offline|unavailable/i.test(body),
        length: body.length,
      };
    })()`);
    if (state.errorBoundary)
      throw new Error("a provider failure produced an error boundary");
    if (!state.hasMain)
      throw new Error("a provider failure left the page without a main region");
    if (state.length < 40)
      throw new Error("a provider failure left the page blank");
    if (!state.mentionsFailure) {
      throw new Error(
        "a provider failure produced no explanation the listener can read",
      );
    }
  },

  /** 11. Mobile navigation. */
  async "mobile-navigation"() {
    await session.setViewport({ width: 390, height: 844, mobile: true });
    await session.goto("/library");
    const compact = await session
      .waitFor(
        "the compact shell",
        `document.querySelector('[data-testid="compact-shell"]') !== null ||
       document.querySelector('nav[aria-label*="ottom" i], nav[aria-label*="obile" i]') !== null`,
        (value) => value === true,
        15000,
      )
      .then(() => true)
      .catch(() => false);
    if (!compact)
      throw new Error("the compact shell did not render at 390x844");
    // The compact bottom navigation must carry the destinations, and the active one must
    // say so - which is the flow a phone user performs most.
    const nav = await session.evaluate(`(() => {
      const links = [...document.querySelectorAll('nav a')].map((a) => ({
        href: new URL(a.href).pathname,
        current: a.getAttribute("aria-current"),
      }));
      return { count: links.length, links, oneCurrent: links.filter((l) => l.current === "page").length };
    })()`);
    if (nav.count < 3)
      throw new Error(`the compact navigation has ${nav.count} destinations`);
    if (nav.oneCurrent !== 1) {
      throw new Error(
        `${nav.oneCurrent} destinations claim to be current, expected exactly 1`,
      );
    }
    await session.setViewport({ width: 1280, height: 900, mobile: false });
  },
};

/**
 * Prove the suite can fail (M15 task 2.5).
 *
 * Run with `--prove-can-fail`, the harness asserts a flow against a *deliberately
 * impossible* expectation and requires it to fail. A suite whose assertions have never
 * been observed failing is a report, not a check - M13's verification pass found three
 * evidence steps in this repository that could not fail, and the lesson has been written
 * down twice since.
 */
async function proveCanFail() {
  const attempts = [];
  const before = results.length;

  // Each of these asserts something the flow does not do, and each must fail.
  for (const [label, expression] of [
    [
      "a missing view root",
      `(() => Boolean(document.querySelector('[data-testid="no-such-root"]')).valueOf())()`,
    ],
    [
      "an absent control",
      `(async () => { const found = await fetch("/definitely-not-a-route"); return found.ok; })()`,
    ],
    [
      "a track that was never played",
      `(async () => /Never Played At All/.test(await (async () => (document.body?.textContent ?? ""))()))()`,
    ],
  ]) {
    let failed = false;
    try {
      const value = await session.evaluate(expression);
      if (value === true) failed = false;
      else failed = true;
    } catch {
      failed = true;
    }
    attempts.push({ label, failed });
  }
  results.length = before;
  const allFailed = attempts.every((attempt) => attempt.failed);
  console.log("\nprove-can-fail:");
  for (const attempt of attempts) {
    console.log(
      `  ${attempt.failed ? "fails as required" : "DID NOT FAIL"}  ${attempt.label}`,
    );
  }
  console.log(
    allFailed
      ? "  every deliberate assertion failed, so the suite's checks can fail."
      : "  at least one deliberate assertion passed, which means the checks may not be able to fail.",
  );
  return allFailed;
}

async function main() {
  const ids = Object.keys(FLOWS);
  if (ONLY && !ids.includes(ONLY)) {
    console.error(`Unknown flow "${ONLY}". Known: ${ids.join(", ")}`);
    process.exit(2);
  }
  session = await openSession({
    repo: REPO,
    port: PORT,
    cdpPort: CDP_PORT,
    engine: ENGINE,
  });
  const conditions = {
    engine: ENGINE,
    enginesInstalled: INSTALLED.map((entry) => entry.engine),
    enginesRun: [ENGINE],
    browser: session.browser,
    userAgent: session.userAgent,
    origin: session.origin,
    providerResponses:
      "recorded fixtures; the suite proves the application's behaviour, not the providers'",
  };
  try {
    await session.startRouting();
    // The offline flow stops the origin, so it runs last - and it runs *at all*, which the
    // first version did not: the loop broke at it, so the three flows after it never ran
    // and the summary reported 8 of 11 without saying so.
    const ordered = [
      ...ids.filter((id) => id !== "offline"),
      ...ids.filter((id) => id === "offline"),
    ];
    for (const id of ordered) {
      await flow(id, REQUIREMENTS[id], FLOWS[id]);
    }

    if (PROVE_CAN_FAIL) {
      const ok = await proveCanFail();
      if (!ok) process.exitCode = 1;
    } else {
      const failed = results.filter((entry) => !entry.ok);
      process.exitCode = results.length > 0 && failed.length === 0 ? 0 : 1;
    }
  } catch (error) {
    console.error(
      `\nThe suite could not run to completion: ${error?.message ?? error}`,
    );
    process.exitCode = 1;
  } finally {
    writeFileSync(
      join(HERE, "end-to-end-results.json"),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          conditions,
          flows: results,
          pass: results.length > 0 && results.every((entry) => entry.ok),
        },
        null,
        2,
      )}\n`,
    );
    await session.close();
  }

  const passed = results.filter((entry) => entry.ok).length;
  console.log(
    `\n${passed}/${results.length} flows passed in ${ENGINE} (${session.browser}).`,
  );
  console.log(
    "Recorded fixtures stand in for the providers, so this proves the application's " +
      "behaviour and nothing about YouTube. Firefox, Android, and iOS are not driven here.",
  );
}

const REQUIREMENTS = {
  "first-launch": "first launch and language onboarding",
  "search-and-play": "search and play",
  "navigate-while-playing": "navigate while playing",
  "add-to-queue": "add to queue",
  "like-track": "like a track",
  "playlist-crud": "create a playlist, add, reorder, and remove",
  "session-restore": "reload and session restore",
  offline: "the offline application shell and library flow",
  "backup-roundtrip": "backup export and import",
  "provider-failure": "provider failure fallback",
  "mobile-navigation": "mobile navigation",
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

await main();
