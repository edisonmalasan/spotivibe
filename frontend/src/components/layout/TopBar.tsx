"use client";

import { NavArrowButton } from "@/components/design-system/NavArrowButton";
import { SearchInput } from "@/components/design-system/SearchInput";
import { Logo } from "@/components/layout/Logo";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * DESIGN.md "Top Navigation Bar": 64px tall void-black strip spanning the
 * viewport — branding + back/forward arrows left, search center-left.
 * The right-hand account/upgrade CTAs of the reference are permanently
 * excluded (accountless product); arrows wire to browser history.
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
      <SearchInput className="w-full sm:w-90" />
      <div className="flex-1" />
    </header>
  );
}
