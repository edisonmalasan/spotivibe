"use client";

import { Button } from "@/components/design-system/Button";
import {
  HOME_FILTER_LABELS,
  HOME_FILTERS,
  type HomeFilter,
  type HomeFilterValue,
} from "@/features/home/homeFilter";

/**
 * Home's `All` / `Music` / `Podcasts` control (M17; spec: `discovery` — "The
 * filter presents a subset of the one section model", "An unrecognised filter
 * presents everything"; design decision 4).
 *
 * The control is deliberately dumb: it reports the chosen value and knows nothing
 * about shelves. All the selection lives in `homeFilter.ts`, which means the
 * control cannot introduce a section even by accident — the worst it can do is
 * pass a value the selector does not recognise, and that is the one case the
 * selector answers by presenting everything.
 *
 * The selection is **for this visit only**: no store, no preference, no URL. A
 * filter is a lens on the feed, not a piece of state the device keeps, and adding
 * a persisted one would be a new dataset for a view preference nobody asked to
 * survive a reload.
 *
 * A native `fieldset`/`legend` with three buttons carries the group name without
 * inventing a role, and `aria-pressed` states which one is on — so the state is
 * announced, not only coloured.
 *
 * Motion: none (design decision 6 — M19 owns the vocabulary).
 */

/** The group's accessible name. */
export const HOME_FILTER_GROUP_LABEL = "Filter Home";

export interface HomeFilterBarProps {
  /** The presented value; an unrecognised one presents everything. */
  value: HomeFilterValue;
  /** Called with the chosen filter. */
  onChange: (filter: HomeFilter) => void;
  className?: string;
}

/**
 * The filter row. Renders the three values the vocabulary defines and nothing
 * else, so a value the surface does not know can only arrive from the initial
 * state — never from this control.
 */
export function HomeFilterBar({ value, onChange, className = "" }: HomeFilterBarProps) {
  return (
    <fieldset className={className} data-testid="home-filter">
      <legend className="sr-only">{HOME_FILTER_GROUP_LABEL}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {HOME_FILTERS.map((filter) => (
          <Button
            key={filter}
            variant="ghost"
            aria-pressed={value === filter}
            data-testid={`home-filter-${filter}`}
            onClick={() => {
              onChange(filter);
            }}
          >
            {HOME_FILTER_LABELS[filter]}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
