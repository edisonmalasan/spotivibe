"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/design-system/Button";
import { SearchInput } from "@/components/design-system/SearchInput";
import {
  LANGUAGES,
  MAX_SELECTED_LANGUAGES,
  normalizeLanguageCodes,
  type LanguageOption,
} from "@/lib/languages";

/**
 * `LanguagePicker` (ROADMAP M8, spec: language catalog and first-run
 * onboarding): the one reusable multi-select over the shared catalog in
 * `lib/languages.ts`, shared by first-run onboarding and by the Settings
 * "Languages" control. Catalog data and normalization are imported from the
 * single shared source so the client can never drift from the server's seed
 * catalog.
 *
 * The picker owns a *draft* selection (so a cancel/discard is the host's
 * decision) and hands the confirmed, catalog-normalized codes back through
 * `onConfirm`. Native checkboxes in a labelled `<fieldset>` keep every option
 * keyboard-operable with a visible focus ring (global `:focus-visible`), and
 * each option's accessible name is its English name; the endonym beside it is
 * visual recognition only. There is no account, sign-in, or email copy
 * anywhere in this surface.
 */

/** Reassurance shown under the catalog in both hosts (spec: changeable later). */
export const LANGUAGE_PICKER_HINT = "You can change this later in Settings.";

/** The cap, spelled out so "select all" filling to the cap is never a surprise. */
export const LANGUAGE_PICKER_LIMIT_HINT = `Choose up to ${MAX_SELECTED_LANGUAGES} languages.`;

/** Copy for a draft that cannot be confirmed yet. */
export const LANGUAGE_PICKER_EMPTY_HINT = "Choose at least one language.";

export interface LanguagePickerProps {
  /** Codes the draft starts from; normalized through the shared catalog. */
  initialCodes?: readonly string[];
  /** Called with the normalized selection when the user confirms. */
  onConfirm(codes: string[]): void;
  /** Accessible label of the confirm control (host-specific copy). */
  confirmLabel?: string;
  /** Disables every control while the host persists the choice. */
  saving?: boolean;
  className?: string;
}

/** Case-insensitive match on the English name, endonym, or code. */
function matches(language: LanguageOption, needle: string): boolean {
  return (
    language.name.toLowerCase().includes(needle) ||
    language.nativeName.toLowerCase().includes(needle) ||
    language.code.toLowerCase().includes(needle)
  );
}

export function LanguagePicker({
  initialCodes,
  onConfirm,
  confirmLabel = "Confirm languages",
  saving = false,
  className = "",
}: LanguagePickerProps) {
  // A draft always starts from a valid catalog selection, so a fresh install
  // is never asked to confirm an empty choice.
  const [draft, setDraft] = useState<string[]>(() =>
    normalizeLanguageCodes([...(initialCodes ?? [])]),
  );
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === "" ? LANGUAGES : LANGUAGES.filter((entry) => matches(entry, needle));
  }, [query]);

  const atCap = draft.length >= MAX_SELECTED_LANGUAGES;
  const disabled = saving;

  function toggle(code: string): void {
    setDraft((current) => {
      if (current.includes(code)) return current.filter((entry) => entry !== code);
      if (current.length >= MAX_SELECTED_LANGUAGES) return current; // cap wins over the click
      return [...current, code];
    });
  }

  /** Fill to the cap in catalog order — the catalog is wider than the cap. */
  function selectAll(): void {
    setDraft(LANGUAGES.slice(0, MAX_SELECTED_LANGUAGES).map((entry) => entry.code));
  }

  function clearSelection(): void {
    setDraft([]);
  }

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          placeholder="Filter languages"
          aria-label="Filter languages"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" onClick={selectAll} disabled={disabled}>
            Select all
          </Button>
          <Button variant="ghost" onClick={clearSelection} disabled={disabled}>
            Clear selection
          </Button>
        </div>
      </div>

      <p aria-live="polite" data-testid="language-picker-count" className="text-body-lg text-mist">
        {draft.length === 0
          ? LANGUAGE_PICKER_EMPTY_HINT
          : `${draft.length} of ${MAX_SELECTED_LANGUAGES} selected — ${LANGUAGE_PICKER_LIMIT_HINT}`}
      </p>

      <fieldset disabled={disabled} className="min-w-0">
        <legend className="mb-2 text-label font-bold text-mist">Languages</legend>
        {visible.length === 0 ? (
          <p data-testid="language-picker-no-matches" className="text-body-lg text-mist">
            No languages match “{query.trim()}”.
          </p>
        ) : (
          <ul className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
            {visible.map((language) => {
              const checked = draft.includes(language.code);
              const showNative = language.nativeName !== language.name;
              const locked = !checked && atCap; // the cap, not a pending write
              return (
                <li key={language.code}>
                  <label
                    className={`flex items-center gap-3 rounded-buttons px-2 py-2 ${
                      locked ? "opacity-60" : "cursor-pointer hover:bg-smoke"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-spotify-green"
                      checked={checked}
                      disabled={locked}
                      aria-label={language.name}
                      onChange={() => toggle(language.code)}
                    />
                    <span className="min-w-0 truncate text-body-lg text-pure-white">
                      {language.name}
                    </span>
                    {showNative && (
                      <span aria-hidden="true" className="min-w-0 truncate text-caption text-fog">
                        {language.nativeName}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-mist">{LANGUAGE_PICKER_HINT}</p>
        <Button
          onClick={() => onConfirm(normalizeLanguageCodes(draft))}
          loading={saving}
          disabled={draft.length === 0}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
