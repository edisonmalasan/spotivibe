"use client";

import { SearchInput } from "@/components/design-system/SearchInput";
import type { SearchSuggestion } from "@/features/search/suggestions";
import { useSearchSuggestions } from "@/features/search/useSearchSuggestions";
import { Clock, Search } from "lucide-react";
import { useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";

/**
 * The search field as a **combobox** (M18 task 4.3; design decision 6).
 *
 * **This establishes the pattern, and it establishes it once.** The repository
 * had no `role="combobox"`, no `role="listbox"`, no `role="option"`, and no
 * `aria-activedescendant` before this component, so the markup below is the first
 * and only definition of them. It follows the ARIA authoring practice for an
 * editable combobox with a listbox popup: the field owns the popup through
 * `aria-controls` and `aria-expanded`, and the active option is exposed through
 * `aria-activedescendant` rather than by moving DOM focus, so the listener keeps
 * typing while the active option changes.
 *
 * **The combobox lives here, not in the `SearchInput` primitive.** `SearchInput`
 * is DESIGN.md's 36px search pill and it is rendered in four places — this field,
 * the library filter, the liked-songs filter, and the language picker's filter —
 * and three of those have no popup at all. An input that declares
 * `role="combobox"` while controlling nothing is worse than an input that
 * declares `searchbox`: assistive technology announces a popup that cannot
 * appear. So the design-system primitive stays what the design document specifies
 * and the combobox contract is a *use* of it, which is also why the ARIA
 * attributes below travel through the primitive's existing prop spread instead of
 * requiring it to learn about suggestions. Nothing about the pill's appearance or
 * its accessible name changes: it is still a search field called "Search".
 *
 * **Focus never leaves the field.** `ArrowUp`/`ArrowDown` move the active option,
 * `Enter` commits it, and `Escape` closes the list and puts focus back on the
 * field — every one of those keys is `preventDefault`ed so the caret does not
 * jump and the page does not scroll. `Escape` is the only one that closes rather
 * than acts, and it declines entirely when the list is already closed, so the
 * shell's own help-dialog dismissal keeps that key.
 */

/** Stable ids, so `aria-controls` and `aria-activedescendant` each name one thing. */
const LISTBOX_ID = "search-suggestion-listbox";

/** The id of the option at `index` — what `aria-activedescendant` points at. */
function optionId(index: number): string {
  return `search-suggestion-${index}`;
}

export interface SearchComboboxProps {
  value: string;
  onChange(event: ChangeEvent<HTMLInputElement>): void;
  /**
   * Accept a suggestion. This is the *same* commit a typed query performs — the
   * caller decides how a query becomes a URL — which is what makes "the URL
   * updates exactly as it does for a typed query" true by construction rather
   * than by a test that has to keep two code paths in step.
   */
  onCommit(query: string): void;
  className?: string;
}

export function SearchCombobox({ value, onChange, onCommit, className = "" }: SearchComboboxProps) {
  const [focused, setFocused] = useState(false);
  /** A dismissed list stays closed until the listener types or asks for it again. */
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Asking is the field's business, not the lane's: no read happens while the
  // field is unfocused or while the list has been dismissed.
  const suggestions = useSearchSuggestions(focused && !dismissed);
  const open = focused && !dismissed && suggestions.length > 0;
  const wrapperRef = useRef<HTMLDivElement>(null);

  /** `SearchInput` does not forward a ref, so the field is found inside the pill. */
  function focusField(): void {
    wrapperRef.current?.querySelector("input")?.focus();
  }

  /** Accept `next` exactly as if it had been typed, then close the list. */
  function commit(next: string): void {
    onCommit(next);
    setDismissed(true);
    setActiveIndex(-1);
  }

  /**
   * The next active option, wrapping at both ends.
   *
   * `-1` (nothing active yet) enters the list at the end the listener pressed —
   * `ArrowDown` at the first option, `ArrowUp` at the last — which is what makes
   * a single press from a closed field useful rather than inert.
   */
  function step(current: number, length: number, down: boolean): number {
    if (current < 0) return down ? 0 : length - 1;
    return (current + (down ? 1 : -1) + length) % length;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (suggestions.length === 0) return; // nothing to move through
        event.preventDefault(); // the caret must not jump to the start/end of the text
        if (dismissed) setDismissed(false); // asking for it re-opens a dismissed list
        setActiveIndex((current) => step(current, suggestions.length, event.key === "ArrowDown"));
        return;
      }
      case "Enter": {
        // Only a *choice* takes Enter. With no active option the key belongs to
        // the form or the page, exactly as it does without a popup open.
        const chosen = open ? suggestions[activeIndex] : undefined;
        if (chosen === undefined) return;
        event.preventDefault();
        commit(chosen.value);
        return;
      }
      case "Escape": {
        // Not ours when the list is closed: the shell's help surface and the
        // existing dialogs own that key, and a combobox that swallowed it
        // everywhere would be a regression rather than a feature.
        if (!open) return;
        event.preventDefault();
        setDismissed(true);
        setActiveIndex(-1);
        focusField();
        return;
      }
      default:
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    setDismissed(false); // a fresh keystroke re-opens a dismissed list
    setActiveIndex(-1);
    onChange(event);
  }

  const activeOptionId = open && activeIndex >= 0 ? optionId(activeIndex) : undefined;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <SearchInput
        value={value}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={LISTBOX_ID}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {open && (
        <ul
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute left-0 right-0 top-full z-40 mt-1 flex max-h-72 flex-col overflow-y-auto rounded-cards bg-carbon p-1 shadow-lg"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              // `mousedown` rather than `click`, and the default is prevented so
              // the field never loses focus on the way to the option: the list
              // belongs to the focused field, and a commit that blurred the field
              // would also have to re-focus it afterwards.
              onMouseDown={(event) => {
                event.preventDefault();
                commit(suggestion.value);
              }}
              className={`flex cursor-pointer items-center gap-2 rounded-buttons px-3 py-2 text-left text-body-lg ${
                index === activeIndex ? "bg-graphite text-pure-white" : "text-mist"
              }`}
            >
              <SuggestionIcon kind={suggestion.kind} />
              <span className="truncate">{suggestion.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Why a suggestion is offered, as an icon.
 *
 * Decorative: the option's text is the suggestion itself, and the *kind* is
 * already carried in the model — the icon repeats it, so it is hidden from
 * assistive technology rather than announced as a second label. `text-fog` is
 * only legal on an `aria-hidden` icon, which is what this is.
 */
function SuggestionIcon({ kind }: { kind: SearchSuggestion["kind"] }): ReactNode {
  return kind === "refinement" ? (
    <Search className="size-4 shrink-0 text-fog" aria-hidden="true" />
  ) : (
    <Clock className="size-4 shrink-0 text-fog" aria-hidden="true" />
  );
}
