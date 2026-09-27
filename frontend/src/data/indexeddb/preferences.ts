import type { Preferences, PreferencesRecord, PreferencesRepository } from "@/data/repositories";
import { DEFAULT_PREFERENCES } from "@/data/repositories";
import { requestToPromise, transactionDone } from "./idb";
import { SINGLE_RECORD_KEY, STORE } from "./schema";

export function createPreferencesRepository(db: IDBDatabase): PreferencesRepository {
  return {
    async get(): Promise<Preferences> {
      const tx = db.transaction(STORE.preferences, "readonly");
      const record = await requestToPromise<PreferencesRecord | undefined>(
        tx.objectStore(STORE.preferences).get(SINGLE_RECORD_KEY),
      );
      if (!record) return { ...DEFAULT_PREFERENCES };
      // Storage records are untrusted at read time: fall back per field.
      return {
        languages: record.languages ?? DEFAULT_PREFERENCES.languages,
        autoplayNext: record.autoplayNext ?? DEFAULT_PREFERENCES.autoplayNext,
        reduceMotion: record.reduceMotion ?? DEFAULT_PREFERENCES.reduceMotion,
        onboardingComplete: record.onboardingComplete ?? DEFAULT_PREFERENCES.onboardingComplete,
      };
    },

    async set(patch: Partial<Preferences>): Promise<Preferences> {
      const current = await this.get();
      const next: Preferences = { ...current, ...patch };
      const record: PreferencesRecord = { id: SINGLE_RECORD_KEY, ...next };
      const tx = db.transaction(STORE.preferences, "readwrite");
      tx.objectStore(STORE.preferences).put(record);
      await transactionDone(tx);
      return next;
    },
  };
}
