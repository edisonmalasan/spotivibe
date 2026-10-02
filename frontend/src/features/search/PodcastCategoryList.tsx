"use client";

import Link from "next/link";
import { Mic } from "lucide-react";
import { SectionHeader } from "@/components/design-system/SectionHeader";
import { PODCAST_CATEGORIES, podcastCategoryQueries } from "@/features/search/podcastCategories";
import { usePreferencesStore } from "@/stores/preferencesStore";

/**
 * The curated podcast categories (M12; spec `podcasts` — "Curated podcast
 * categories", design decision 6).
 *
 * Each entry is a **link into a podcast-mode search**, not a feed and not a
 * button that fetches: the URL it produces is the shareable, bookmarkable state
 * a listener can hand to someone else, and it means a category can never be a
 * stale shelf of results fetched once. The query text is resolved per selected
 * language inside `podcastCategories`, so this component holds no query strings
 * of its own.
 *
 * Nothing here claims a ranking: the order is the catalog's authoring order and
 * the labels name genres, not "best".
 */
export function PodcastCategoryList({ className = "" }: { className?: string }) {
  const languages = usePreferencesStore((state) => state.languages);

  return (
    <section className={`flex flex-col gap-4 ${className}`} data-testid="podcast-categories">
      <SectionHeader title="Browse podcast categories" />
      <p className="text-body-lg text-mist">
        Start with a category — each opens a podcast search you can keep, share, or come back to.
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {PODCAST_CATEGORIES.map((category) => {
          const query = podcastCategoryQueries(category, languages)[0] ?? category.label;
          return (
            <li key={category.id}>
              <Link
                href={`/search?q=${encodeURIComponent(query)}&mode=podcast`}
                data-testid={`podcast-category-${category.id}`}
                className="motion-feedback flex w-full items-center gap-3 rounded-cards bg-carbon p-3 text-left hover:bg-graphite"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-cards bg-graphite">
                  <Mic className="size-5 text-fog" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body-lg font-semibold text-pure-white">
                    {category.label}
                  </span>
                  {/* The resolved query is visible: the listener knows what they
                      are about to search for before the results arrive. */}
                  <span className="truncate text-caption text-mist">{query}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
