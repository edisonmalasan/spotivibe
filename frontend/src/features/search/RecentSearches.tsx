"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/design-system/Button";
import { IconButton } from "@/components/design-system/IconButton";
import { getLocalData } from "@/data/localData";
import type { SearchEntryRecord } from "@/data/repositories";
import { SearchBrowseEmpty } from "@/features/search/SearchBrowseEmpty";

/**
 * Browse-state recent searches (design §5/§7, spec "Local-first search
 * history"): newest-first list with per-entry remove and clear-all, all
 * through repository APIs. While nothing is loaded — or once the list is
 * empty — the M1 browse empty state renders, so the surface is never blank.
 */
export function RecentSearches({ onSelect }: { onSelect(query: string): void }) {
  const [entries, setEntries] = useState<SearchEntryRecord[]>([]);

  const refresh = useCallback((): void => {
    // Loaded through promise callbacks (never synchronously in an effect).
    void getLocalData()
      .then((data) => data.searchHistory.list())
      .then((list) => setEntries(list))
      .catch((error: unknown) => {
        // Storage unavailable: keep the browse empty state rather than a list
        // that would silently lose the user's history.
        console.warn("[search] recent searches unavailable:", error);
        setEntries([]);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function remove(entry: SearchEntryRecord): Promise<void> {
    try {
      const data = await getLocalData();
      await data.searchHistory.remove(entry.query);
    } catch (error) {
      console.warn("[search] remove recent search failed:", error);
    }
    refresh();
  }

  async function clearAll(): Promise<void> {
    try {
      const data = await getLocalData();
      await data.searchHistory.clear();
    } catch (error) {
      console.warn("[search] clear recent searches failed:", error);
    }
    refresh();
  }

  if (entries.length === 0) return <SearchBrowseEmpty />;

  return (
    <section aria-labelledby="recent-searches-heading">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 id="recent-searches-heading" className="text-heading font-bold text-pure-white">
          Recent searches
        </h2>
        <Button variant="ghost" onClick={() => void clearAll()}>
          Clear all
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.normalizedQuery}
            className="flex items-center gap-3 rounded-cards bg-smoke px-3 py-2"
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-body-lg font-regular text-pure-white transition hover:text-mist"
              onClick={() => onSelect(entry.query)}
            >
              {entry.query}
            </button>
            <IconButton label={`Remove ${entry.query}`} onClick={() => void remove(entry)}>
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
