"use client";

import { NavArrowButton } from "@/components/design-system/NavArrowButton";
import { Logo } from "@/components/layout/Logo";
import { SearchCombobox } from "@/features/search/SearchCombobox";
import { buildSearchUrl } from "@/lib/searchUrl";
import { useSearchStore } from "@/stores/searchStore";
import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ChangeEvent } from "react";

/** URL-write cadence shared with the search page (design decision §3). */
const URL_SYNC_DEBOUNCE_MS = 300;

/**
 * DESIGN.md "Top Navigation Bar": 64px tall void-black strip spanning the
 * viewport — branding + back/forward arrows left, search center-left.
 * The right-hand account/upgrade CTAs of the reference are permanently
 * excluded (accountless product); arrows wire to browser history, and the
 * right-hand spacer carries the settings gear (app-shell R2 amendment).
 *
 * The search input is controlled by `searchStore` (design decision §2): edits
 * update the store immediately (no input lag), then a debounced `replace` to
 * `/search?q=...` navigates from any other route — AppShell owns this bar, so
 * focus survives the navigation. On the Search route the page host owns URL
 * sync, so this component writes nothing there.
 *
 * **M18 renders the field as `SearchCombobox` rather than as a bare
 * `SearchInput`** (design decision 6): the combobox markup — `role="combobox"`,
 * the listbox popup, `aria-activedescendant` — is feature behaviour, and this
 * bar is the only one of the four `SearchInput` sites that has a popup to offer.
 * The commit a suggestion performs goes through the *same* {@link commit} as a
 * keystroke, so accepting a suggestion writes the URL by exactly the path typing
 * does rather than by a second one that has to be kept in step.
 */
export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchStore((state) => state.query);
  const setQuery = useSearchStore((state) => state.setQuery);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const issuedRef = useRef<string | null>(null);

  // A route change means the current URL is no longer ours to compare
  // against; dropping the compare-first memory keeps the next edit writing,
  // and any pending write from the previous route is cancelled with it.
  useEffect(() => {
    issuedRef.current = null;
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [pathname]);

  /**
   * Adopt `next` as the field's value and schedule the URL write for it.
   *
   * One function serves both a keystroke and a committed suggestion, which is the
   * point: the requirement is that accepting a suggestion updates the URL exactly
   * as typing does, and two code paths would be two things to keep in step.
   */
  function commit(next: string): void {
    setQuery(next); // immediate — the controlled input never lags behind typing
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pathname === "/search") return; // the page host owns URL sync there
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const target = buildSearchUrl(next);
      if (target === issuedRef.current) return; // compare-first: already written
      issuedRef.current = target;
      router.replace(target);
    }, URL_SYNC_DEBOUNCE_MS);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    commit(event.target.value);
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 bg-void-black px-4">
      <Link href="/" className="shrink-0 rounded-buttons">
        <Logo />
      </Link>
      <div className="hidden items-center gap-2 sm:flex">
        <NavArrowButton direction="back" onClick={() => router.back()} />
        <NavArrowButton direction="forward" onClick={() => router.forward()} />
      </div>
      {/* min-w-0 lets the pill shrink below its min-content on narrow
          viewports so the settings gear is never pushed off-screen. */}
      <SearchCombobox
        className="w-full min-w-0 sm:w-90"
        value={query}
        onChange={handleChange}
        onCommit={commit}
      />
      <div className="flex-1" />
      {/* Settings entry — mirrors the IconButton sm/default contract as a link
          (navigation target, not an action) with a required accessible name. */}
      <Link
        href="/settings"
        aria-label="Settings"
        className="motion-feedback inline-flex size-8 shrink-0 items-center justify-center rounded-buttons text-pure-white hover:bg-smoke"
      >
        <Settings aria-hidden="true" className="size-4" />
      </Link>
    </header>
  );
}
