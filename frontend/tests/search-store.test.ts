import { beforeEach, describe, expect, it } from "vitest";
import { initialSearchState, resetSearchStore, useSearchStore } from "@/stores/searchStore";

describe("searchStore (task 1.1)", () => {
  beforeEach(() => {
    resetSearchStore();
  });

  it("starts with an empty query", () => {
    expect(useSearchStore.getState().query).toBe("");
    expect(initialSearchState.query).toBe("");
  });

  it("round-trips query updates through setQuery", () => {
    useSearchStore.getState().setQuery("Radiohead");
    expect(useSearchStore.getState().query).toBe("Radiohead");

    // Raw text is preserved — trimming belongs to request/record building.
    useSearchStore.getState().setQuery("  karma police  ");
    expect(useSearchStore.getState().query).toBe("  karma police  ");

    useSearchStore.getState().setQuery("");
    expect(useSearchStore.getState().query).toBe("");
  });

  it("holds only the query and its setter — no result or status state", () => {
    expect(Object.keys(useSearchStore.getState()).sort()).toEqual(["query", "setQuery"]);
  });
});
