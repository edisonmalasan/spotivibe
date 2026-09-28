"use client";

import { NavArrowButton } from "@/components/design-system/NavArrowButton";
import { SearchInput } from "@/components/design-system/SearchInput";
import { Logo } from "@/components/layout/Logo";
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

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
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
      <SearchInput className="w-full min-w-0 sm:w-90" value={query} onChange={handleChange} />
      <div className="flex-1" />
      {/* Settings entry — mirrors the IconButton sm/default contract as a link
          (navigation target, not an action) with a required accessible name. */}
      <Link
        href="/settings"
        aria-label="Settings"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-buttons text-pure-white transition hover:bg-smoke"
      >
        <Settings aria-hidden="true" className="size-4" />
      </Link>
    </header>
  );
}
