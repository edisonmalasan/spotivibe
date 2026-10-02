"use client";

import { Compass, House, Library, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

interface BottomNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const items: BottomNavItem[] = [
  { href: "/", label: "Home", icon: House },
  { href: "/search", label: "Search", icon: Search },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/library", label: "Library", icon: Library },
];

/**
 * Compact-shell primary navigation pinned above the safe area: 64px carbon bar
 * with Home/Search/Discover/Library, mist at rest and pure white + aria-current
 * for the active destination. Discover is a primary destination (M8 added the
 * `/discover` genre/language surface), so it is reachable from the compact
 * shell and not only by typing a URL. Hidden from 1024px up.
 */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="flex h-16 shrink-0 items-stretch justify-around bg-carbon lg:hidden"
    >
      {items.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`motion-feedback flex flex-1 flex-col items-center justify-center gap-1 py-2 ${
              active ? "text-pure-white" : "text-fog hover:text-mist"
            }`}
          >
            <Icon className="size-6" aria-hidden="true" />
            {/* M14: the label picks its own colour rather than inheriting one. It used
                to inherit `fog`, which painted this 12px label at 4.16:1 on the nav's
                carbon background - under the 4.5:1 minimum for small text. `mist` is
                what DESIGN.md specifies for secondary text, and the active destination
                keeps pure white, which the first fix here lost. */}
            <span
              className={`text-caption font-regular ${active ? "text-pure-white" : "text-mist"}`}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
