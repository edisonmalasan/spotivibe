"use client";

import { NavArrowButton } from "@/components/design-system/NavArrowButton";
import { SearchInput } from "@/components/design-system/SearchInput";
import { Logo } from "@/components/layout/Logo";
import { Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * DESIGN.md "Top Navigation Bar": 64px tall void-black strip spanning the
 * viewport — branding + back/forward arrows left, search center-left.
 * The right-hand account/upgrade CTAs of the reference are permanently
 * excluded (accountless product); arrows wire to browser history, and the
 * right-hand spacer carries the settings gear (app-shell R2 amendment).
 */
export function TopBar() {
  const router = useRouter();
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
      <SearchInput className="w-full min-w-0 sm:w-90" />
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
