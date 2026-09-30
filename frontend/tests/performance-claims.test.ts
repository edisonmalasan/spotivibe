import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POLL_INTERVAL_MS } from "@/player/engine";
import { RECENT_HISTORY_LIMIT } from "@/stores/historyStore";
import { HISTORY_LIMIT } from "@/stores/queueStore";

/**
 * M14 tasks 3.3, 3.4, 3.5: the performance requirements that are claims about the
 * *absence* of things.
 *
 * Each of these is the kind of requirement that is easy to declare and hard to keep:
 * no telemetry, bounded lists, and nothing repeating while the application is idle.
 * Without a check, each decays silently - one analytics call in a new surface, one
 * unbounded list, one `setInterval` someone added "just to refresh".
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");
const SRC = join(FRONTEND, "src");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(full);
    }
  };
  walk(dir);
  return found;
}

describe("nothing is transmitted about the person using the application (task 3.3)", () => {
  it("contains no analytics, beacon, or remote-reporting call", () => {
    const files = sourceFiles(SRC);
    expect(files.length, "the walker must reach the sources").toBeGreaterThan(50);

    // Each pattern is a way an application's behaviour would leave the device
    // without the person asking. None is a legitimate use in this application: it
    // has no accounts, no server of its own, and no third-party analytics.
    const reporting: Array<{ label: string; pattern: RegExp }> = [
      { label: "navigator.sendBeacon", pattern: /\bsendBeacon\b/ },
      { label: "Google Analytics", pattern: /\bgtag\b|\bdataLayer\b|\bGoogleAnalytics\b/ },
      {
        label: "a page-view beacon call",
        pattern: /\btrackPageView\b|\bpageview\b|\bpage_view\b/i,
      },
      {
        label: "an error-reporting SDK",
        pattern: /\bSentry\b|\bBugsnag\b|\bDatadog\b|\bRollbar\b/,
      },
      {
        // `plausible` is deliberately absent: it is an ordinary English word that occurs
        // in this repository's quality-scoring comments, and the first version of this
        // detector flagged a comment in server/music/score.ts as an analytics SDK. The
        // unambiguous vendor names are the ones worth catching.
        label: "an analytics wrapper",
        pattern: /\bposthog\b|\bsegment\.io\b|\bmixpanel\b|\bamplitude\b/i,
      },
      {
        label: "a remote configuration fetch",
        pattern: /\bflagsmith\b|\bLaunchDarkly\b|\bunleash\b/i,
      },
    ];

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const { label, pattern } of reporting) {
        if (pattern.test(source)) offenders.push(`${relative(SRC, file)}: ${label}`);
      }
    }
    expect(offenders, "no source may report about the listener").toEqual([]);
  });

  it("has no host outside its own that a browser-side request could reach", () => {
    // A stronger version of the same rule: the security policy already pins this, but
    // the check belongs here too, where someone reading about telemetry will find it.
    // Server-side provider origins are expected and live under `src/server`.
    const clientFiles = sourceFiles(SRC).filter(
      (file) => !file.includes(`${join("src", "server")}`),
    );
    const unexpected: string[] = [];
    for (const file of clientFiles) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
        const origin = `https://${match[1].toLowerCase()}`;
        // Three origins the browser legitimately references, and each for a different
        // reason worth naming:
        //
        // - `www.youtube.com` - the IFrame API script and the embed frame.
        // - `i.ytimg.com` - artwork, as URLs the server built.
        // - `youtube.com` without `www` - an *outbound link* the listener can follow
        //   (a watch page, a playlist to import). A link is not a fetch: the browser
        //   does not connect to it, so it is not a way for the application to report
        //   anything. The security-policy suite separately proves the policy does not
        //   permit it for any directive that would allow a request.
        if (
          origin === "https://www.youtube.com" ||
          origin === "https://i.ytimg.com" ||
          origin === "https://youtube.com"
        ) {
          continue;
        }
        unexpected.push(`${relative(SRC, file)}: ${origin}`);
      }
    }
    expect(unexpected, "no client-side origin beyond the player and artwork").toEqual([]);
  });
});

describe("an export carries nothing but the listener's own data (spec security)", () => {
  it("holds no server-side value, even while provider configuration is present", async () => {
    // The scenario the independent verification pass found untested. Provider
    // configuration lives in the environment and is read server-side; nothing in the
    // export path may reach for it, and the assertion is made with such a value
    // genuinely *set* rather than merely absent - "it was not there to leak" is not the
    // same claim as "it would not be exported if it were".
    const { serializeBackup } = await import("@/data/backup");
    const { makeBackupData } = await import("./helpers/backup-fixtures");
    const secret = "spotivibe-test-secret-value";
    const name = "SPOTIVIBE_YT_COOKIE";
    const previous = process.env[name];
    process.env[name] = secret;
    try {
      const envelope = JSON.stringify(serializeBackup(makeBackupData()));
      expect(envelope).not.toContain(secret);
      // Nor the name of a provider setting: an export that carried configuration
      // *names* would tell a reader what this deployment reads.
      expect(envelope).not.toContain("SPOTIVIBE");
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });
});

describe("local lists stay bounded (task 3.4)", () => {
  it("names the bound, and states it where the list is truncated", () => {
    // A bound nobody can see is a bound the next person will raise by accident.
    expect(RECENT_HISTORY_LIMIT).toBeGreaterThan(0);
    const view = readFileSync(join(SRC, "features", "history", "HistoryView.tsx"), "utf8");
    // The surface interpolates the constant into its own copy rather than repeating
    // the number, so the two cannot drift apart.
    expect(view).toMatch(/up to \{RECENT_HISTORY_LIMIT\}/);
  });

  it("keeps the recently-played state within its bound", () => {
    expect(RECENT_HISTORY_LIMIT).toBeLessThanOrEqual(100);
    expect(HISTORY_LIMIT).toBeLessThanOrEqual(100);
    // The store *delegates* the bound to the repository rather than slicing its own
    // copy afterwards - one place applies it, and the data never enters memory
    // unbounded. (The first version of this test expected a `slice` in the store and
    // failed on a store that had simply done it better.)
    const store = readFileSync(join(SRC, "stores", "historyStore.ts"), "utf8");
    expect(store).toMatch(/\.list\(RECENT_HISTORY_LIMIT\)/);
  });

  it("bounds the repository read as well as the state", () => {
    // Trimming in the store alone would still read an unbounded dataset into memory
    // on every hydration, which is the expensive part.
    const repository = readFileSync(join(SRC, "data", "indexeddb", "listeningHistory.ts"), "utf8");
    expect(repository).toMatch(/\blist\(limit\??: number\)/);
    const store = readFileSync(join(SRC, "stores", "historyStore.ts"), "utf8");
    expect(store).toMatch(/\.list\(RECENT_HISTORY_LIMIT\)/);
  });
});

/**
 * What this sweep cannot see, stated rather than implied: a self-rescheduling
 * `setTimeout`, a `requestAnimationFrame` loop, or an interval reached only through
 * indirection. The original task asked for a test that counts timers across an idle
 * mount and a playback start/stop; that needs a fake YouTube-player harness to reach
 * the engine's poll, so the check here is a sweep, and the task was amended to say so.
 */
describe("nothing repeats while the application is idle (task 3.5)", () => {
  it("has exactly one interval in the application, and it belongs to the player", () => {
    const intervals: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      if (/\bsetInterval\s*\(/.test(source))
        intervals.push(relative(SRC, file).replace(/\\/g, "/"));
    }
    // One, in the player engine, where the state it observes is playback. A second
    // one would be work driven by idleness rather than by an event.
    expect(intervals).toEqual(["player/engine.ts"]);
  });

  it("starts and stops the player's poll with playback", () => {
    const engine = readFileSync(join(SRC, "player", "engine.ts"), "utf8");
    // Both halves, or the timer outlives the thing it observes.
    expect(engine).toMatch(/private startPoll\(\)/);
    expect(engine).toMatch(/private stopPoll\(\)/);
    // And the start is idempotent, so a resume cannot leave two timers running.
    expect(engine).toMatch(/if \(this\.pollTimer\) return;/);
    expect(POLL_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("does not write local data on a timer", () => {
    // The session persistence and the listening recorder are both event-driven (M4,
    // M6); a timer-driven write would be a battery and a flash concern.
    for (const file of sourceFiles(join(SRC, "stores"))) {
      const source = readFileSync(file, "utf8");
      expect(/\bsetInterval\s*\(/.test(source), relative(SRC, file)).toBe(false);
    }
  });
});
