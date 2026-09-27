import { createRepositories, type RepositorySet } from "./indexeddb";

export type { RepositorySet };

let pending: Promise<RepositorySet> | undefined;

/**
 * Shared accessor for the local-data connection — a genuine cross-cutting
 * service (one IndexedDB connection for the whole app, opened lazily).
 * Feature code imports this module instead of the IndexedDB implementation.
 * A failed open clears the memo so a caller can retry once storage is
 * available again (Settings error state).
 */
export function getLocalData(): Promise<RepositorySet> {
  if (!pending) {
    pending = createRepositories().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}
