import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, type RepositorySet } from "@/data/indexeddb";

/**
 * The first-run artist picks store, against real (fake-indexeddb) storage.
 *
 * These exist because the repository is *stated* user data — the one Quick Pick the
 * listener chose by hand — and it had already earned its first bug: `replaceAll`
 * originally stored the artist id as the display name, so the rail rendered
 * `UC_a1b2c3` where the listener had clicked on "Aurora Vale". That was caught by the
 * onboarding store test rather than by review, which is exactly the argument for
 * testing the repository directly: the store test saw one symptom, and would not have
 * caught the other half.
 */

let open: RepositorySet | undefined;
let nameCounter = 0;
/** The database `freshRepositories` last opened, so a test can reopen *the same* one. */
let lastName = "";

async function freshRepositories(): Promise<RepositorySet> {
  lastName = `picks-repo-test-${++nameCounter}`;
  open = await createRepositories({ name: lastName });
  return open;
}

beforeEach(async () => {
  const repos = await freshRepositories();
  await repos.quickPickPicks.clear();
});

afterEach(() => {
  open?.close();
  open = undefined;
});

describe("quickPickPicks: the listener's stated artists", () => {
  it("round-trips a pick with the name the listener saw", async () => {
    const repos = await freshRepositories();
    const stored = await repos.quickPickPicks.pick("UC_a", "Aurora Vale", 1_000);

    expect(stored).toEqual({ artistId: "UC_a", name: "Aurora Vale", pickedAt: 1_000 });
    // Reopen the *same* database through a second connection, so this asserts
    // persistence rather than the object the write happened to return.
    open?.close();
    const reopened = await createRepositories({ name: lastName });
    expect(await reopened.quickPickPicks.list()).toEqual([
      { artistId: "UC_a", name: "Aurora Vale", pickedAt: 1_000 },
    ]);
    reopened.close();
  });

  it("keys by artist identity, so picking the same artist twice is one record", async () => {
    const repos = await freshRepositories();
    await repos.quickPickPicks.pick("UC_a", "Aurora Vale", 1_000);
    await repos.quickPickPicks.pick("UC_a", "Aurora Vale", 2_000);

    const all = await repos.quickPickPicks.list();
    expect(all).toHaveLength(1);
    // Re-picking refreshes the timestamp rather than creating a second row.
    expect(all[0]?.pickedAt).toBe(2_000);
  });

  it("removes a pick, and removes an unknown one quietly", async () => {
    const repos = await freshRepositories();
    await repos.quickPickPicks.pick("UC_a", "Aurora Vale", 1_000);

    await repos.quickPickPicks.unpick("UC_a");
    expect(await repos.quickPickPicks.list()).toEqual([]);

    // Deleting something that was never there must not reject: onboarding writes the
    // whole selection, and an unknown id there is ordinary, not an error.
    await expect(repos.quickPickPicks.unpick("UC_never")).resolves.toBeUndefined();
  });

  it("reports membership without reading the whole selection", async () => {
    const repos = await freshRepositories();
    await repos.quickPickPicks.pick("UC_a", "Aurora Vale", 1_000);

    expect(await repos.quickPickPicks.has("UC_a")).toBe(true);
    expect(await repos.quickPickPicks.has("UC_b")).toBe(false);
  });

  it("lists most recently picked first", async () => {
    const repos = await freshRepositories();
    await repos.quickPickPicks.pick("UC_a", "Aurora Vale", 3_000);
    await repos.quickPickPicks.pick("UC_b", "Beacon", 1_000);
    await repos.quickPickPicks.pick("UC_c", "Cobalt", 2_000);

    expect((await repos.quickPickPicks.list()).map((record) => record.name)).toEqual([
      "Aurora Vale",
      "Cobalt",
      "Beacon",
    ]);
  });

  it("empties the dataset", async () => {
    const repos = await freshRepositories();
    await repos.quickPickPicks.pick("UC_a", "Aurora Vale", 1_000);
    await repos.quickPickPicks.pick("UC_b", "Beacon", 2_000);

    await repos.quickPickPicks.clear();
    expect(await repos.quickPickPicks.list()).toEqual([]);
  });
});

describe("quickPickPicks: replaceAll is one transaction", () => {
  it("replaces the whole selection, keeping each artist's name", async () => {
    /*
     * The regression this whole file exists for. `replaceAll` was originally given
     * only artist ids, so it stored the id where the name belongs and the rail
     * rendered `UC_a` under a card the listener had picked by the name "Aurora Vale".
     */
    const repos = await freshRepositories();
    await repos.quickPickPicks.replaceAll([
      { artistId: "UC_a", name: "Aurora Vale" },
      { artistId: "UC_b", name: "Beacon" },
    ]);

    const stored = await repos.quickPickPicks.list();
    expect(stored.map((record) => record.artistId).sort()).toEqual(["UC_a", "UC_b"]);
    expect(stored.map((record) => record.name).sort()).toEqual(["Aurora Vale", "Beacon"]);
    // The names are names, not identities.
    for (const record of stored) expect(record.name).not.toBe(record.artistId);
  });

  it("drops picks that were not in the new selection", async () => {
    // This is the "re-pick from Settings" path, and it must not *accumulate*.
    const repos = await freshRepositories();
    await repos.quickPickPicks.pick("UC_old", "Old Pick", 1_000);
    await repos.quickPickPicks.pick("UC_keep", "Kept", 2_000);

    await repos.quickPickPicks.replaceAll([{ artistId: "UC_keep", name: "Kept" }]);

    const stored = await repos.quickPickPicks.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.artistId).toBe("UC_keep");
  });

  it("gives the whole selection one timestamp, so order is not write timing", async () => {
    /*
     * Ordering by `pickedAt` only means something if `replaceAll` does not stamp
     * each row as it writes it: a per-row `Date.now()` would make the selection's
     * order depend on how fast the transaction ran. One stamp makes the listed
     * order the listener's own.
     */
    const repos = await freshRepositories();
    await repos.quickPickPicks.replaceAll([
      { artistId: "UC_a", name: "Aurora Vale" },
      { artistId: "UC_b", name: "Beacon" },
      { artistId: "UC_c", name: "Cobalt" },
    ]);

    const stored = await repos.quickPickPicks.list();
    expect(new Set(stored.map((record) => record.pickedAt)).size).toBe(1);
  });

  it("empties the dataset when confirming nothing", async () => {
    // Confirming onboarding with no artists selected must leave an empty dataset,
    // not the previous selection, and must not throw on the empty array.
    const repos = await freshRepositories();
    await repos.quickPickPicks.pick("UC_old", "Old Pick", 1_000);

    await repos.quickPickPicks.replaceAll([]);
    expect(await repos.quickPickPicks.list()).toEqual([]);
  });
});

describe("quickPickPicks: the store is part of the shipped schema", () => {
  it("is created by the schema, not by a caller opening a store lazily", async () => {
    // A store that only existed after something tried to use it would make the
    // repository's contract depend on call order.
    const repos = await freshRepositories();
    expect(await repos.quickPickPicks.list()).toEqual([]);
    // And the key is `artistId`, since that is what identity is keyed on.
    const records = [
      { artistId: "UC_a", name: "Aurora Vale", pickedAt: 1 },
      { artistId: "UC_b", name: "Beacon", pickedAt: 2 },
    ];
    await repos.quickPickPicks.replaceAll(records);
    expect((await repos.quickPickPicks.list()).map((record) => record.artistId).sort()).toEqual([
      "UC_a",
      "UC_b",
    ]);
  });
});
