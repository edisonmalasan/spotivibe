import { create } from "zustand";
import { getLocalData } from "@/data/localData";
import { DEFAULT_PREFERENCES, type Preferences } from "@/data/repositories";
import { DEFAULT_LANGUAGE, normalizeLanguageCodes } from "@/lib/languages";

/**
 * `preferencesStore` (ROADMAP M8, design §5): the client authority for the
 * local preferences dataset — selected languages, the onboarding flag, and the
 * playback/motion toggles. Until M8 it was implemented and backed up but never
 * read or written; the language onboarding surface owns it now.
 *
 * Layering: components → preferencesStore → the `PreferencesRepository`
 * interface (never `data/indexeddb`). Actions are repository-first — the write
 * is awaited before state updates, so a failed write leaves the UI exactly as
 * it was and rejects for the surface to report. This module never imports
 * `playerStore` (architecture-tested): a preference cannot touch transport.
 *
 * `state.languages` is the **effective** selection: the stored codes normalized
 * through the shared catalog, so it is never empty (a fresh install reads as
 * `[DEFAULT_LANGUAGE]` while the repository still holds `[]`). That guarantee is
 * what lets a discovery request always carry at least one catalog code.
 *
 * **M10 adds `autofillQueue`** (spec `radio` — "Queue autofill"; design §6).
 * It follows the existing pattern exactly — a field on `Preferences`, a default
 * drawn from `DEFAULT_PREFERENCES`, the same repository-first write, and no new
 * storage path — so the Settings toggle, the backup envelope, and the refill
 * engine all read the same one value.
 */

export interface PreferencesState {
  /** Effective selection: 1..8 unique catalog codes, in the user's order. */
  languages: string[];
  /** Whether first-run language onboarding has been confirmed. */
  onboardingComplete: boolean;
  /** Playback preference: advance to the next track automatically. */
  autoplayNext: boolean;
  /** UI/accessibility preference: honor reduced-motion requests. */
  reduceMotion: boolean;
  /**
   * Whether an ordinary queue may be topped up with more tracks before it ends
   * (M10, default on). Radio is *not* gated by this: a radio only starts from
   * an explicit user gesture.
   */
  autofillQueue: boolean;
  /** True once the first successful read has settled. */
  hydrated: boolean;

  /**
   * Read the preferences from the repository. Concurrent callers share one
   * in-flight read; a later call re-reads rather than append, so bulk writes
   * (Settings reset, backup import) can resync the store.
   */
  hydrate(): Promise<void>;
  /** Persist a new language selection through the repository. */
  setLanguages(codes: readonly string[]): Promise<void>;
  /** Persist the selection and mark first-run onboarding complete in one write. */
  completeOnboarding(codes: readonly string[]): Promise<void>;
  /**
   * Persist the queue-autofill setting. Repository-first like every other
   * write: a failed write rejects and leaves the stored value — and therefore
   * the effective one — exactly as it was, so the toggle can never show a state
   * the device did not accept.
   */
  setAutofillQueue(enabled: boolean): Promise<void>;
}

/** Store defaults before hydration — never claim a preference was read. */
export const initialPreferencesState = {
  languages: [DEFAULT_LANGUAGE] as string[],
  onboardingComplete: DEFAULT_PREFERENCES.onboardingComplete,
  autoplayNext: DEFAULT_PREFERENCES.autoplayNext,
  reduceMotion: DEFAULT_PREFERENCES.reduceMotion,
  autofillQueue: DEFAULT_PREFERENCES.autofillQueue,
  hydrated: false,
};

let hydrateInFlight: Promise<void> | null = null;
/** Monotonic token so a slow stale write can never overwrite a newer one. */
let writeToken = 0;

/** Reset preference data — test isolation and hot-reload hygiene. */
export function resetPreferencesStore(): void {
  hydrateInFlight = null;
  writeToken = 0;
  usePreferencesStore.setState({ ...initialPreferencesState, languages: [DEFAULT_LANGUAGE] });
}

/** Stored codes reduced to the effective selection (always ≥ 1 catalog code). */
function effectiveLanguages(stored: readonly string[] | undefined): string[] {
  return normalizeLanguageCodes(stored ?? []);
}

/** Reflect a repository read/write result in state. */
function applyPreferences(preferences: Preferences): void {
  usePreferencesStore.setState({
    languages: effectiveLanguages(preferences.languages),
    onboardingComplete: preferences.onboardingComplete,
    autoplayNext: preferences.autoplayNext,
    reduceMotion: preferences.reduceMotion,
    autofillQueue: preferences.autofillQueue,
    hydrated: true,
  });
}

async function readPreferences(): Promise<Preferences> {
  const data = await getLocalData();
  return data.preferences.get();
}

/** Repository first, UI second — a failed write rejects with state untouched. */
async function writePreferences(patch: Partial<Preferences>): Promise<void> {
  const token = ++writeToken;
  const data = await getLocalData();
  const saved = await data.preferences.set(patch);
  if (token === writeToken) applyPreferences(saved);
}

export const usePreferencesStore = create<PreferencesState>()(() => ({
  ...initialPreferencesState,

  hydrate() {
    if (!hydrateInFlight) {
      hydrateInFlight = readPreferences()
        .then(applyPreferences)
        .finally(() => {
          hydrateInFlight = null;
        });
    }
    return hydrateInFlight;
  },

  async setLanguages(codes) {
    await writePreferences({ languages: normalizeLanguageCodes(codes) });
  },

  async completeOnboarding(codes) {
    await writePreferences({ languages: normalizeLanguageCodes(codes), onboardingComplete: true });
  },

  async setAutofillQueue(enabled) {
    await writePreferences({ autofillQueue: enabled });
  },
}));
